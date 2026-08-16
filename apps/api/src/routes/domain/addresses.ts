import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { Prisma } from "@prisma/client";
import {
  cansToCadence,
  cansToCanCount,
  cansHaveGlass,
  createAddressRequestSchema,
  isAdminRole,
  pickupScheduleSuggestionSchema,
  SERVICE_FLAT_PRICING_CENTS,
  scheduleUpdateSchema,
  serviceAddressInputSchema,
  serviceAddressSchema,
  serviceHoldInputSchema,
  serviceHoldSchema,
  servicesUpdateSchema
} from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../../lib/http";
import { withAuth } from "../../lib/withAuth";
import { canActForAddress, canActForUser } from "../../lib/ownership";
import { geocodeAddressParts } from "../../services/geocoding";
import { lookupPickupSchedule } from "../../services/haulerSchedule";
import {
  applyLocationServices,
  getLocationServices,
  schedulesFromServices
} from "../../services/locationServices";
import { timezoneForCoords } from "../../lib/timezone";

type ScheduleRow = {
  id: string;
  serviceAddressId: string;
  pickupDayOfWeek: number;
  cadence: string;
  biweeklyAnchorDate: Date | null;
  canCount: number;
  rollIn: boolean;
  glassRecycling: boolean;
  petWasteDogs: number;
  providerSynced: boolean;
  cans: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function toScheduleResponse(row: ScheduleRow) {
  return {
    id: row.id,
    serviceAddressId: row.serviceAddressId,
    dayOfWeek: row.pickupDayOfWeek,
    cans: row.cans ?? [],
    cadence: row.cadence,
    biweeklyAnchorDate: row.biweeklyAnchorDate?.toISOString(),
    canCount: row.canCount,
    rollIn: row.rollIn,
    glassRecycling: row.glassRecycling,
    petWasteDogs: row.petWasteDogs,
    providerSynced: row.providerSynced,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toAddressResponse(address: {
  id: string;
  userId: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  lat: { toNumber: () => number };
  lng: { toNumber: () => number };
  timezone: string;
  accessNotes: string;
  gateCode: string | null;
  canCount: number;
  pickupsPerWeek: number;
  rollIn: boolean;
  isActive: boolean;
  serviceApprovedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  locationServices?: Array<{
    type: string;
    options: unknown;
    days: Array<{
      dayOfWeek: number;
      cadence: string;
      biweeklyAnchorDate: Date | null;
      rollIn: boolean;
      providerSynced: boolean;
      cans: unknown;
    }>;
  }>;
}) {
  // The schedule response is projected from the location's services.
  const schedules = schedulesFromServices(
    address.id,
    address.locationServices ?? [],
    address.updatedAt
  );
  return serviceAddressSchema.parse({
    ...address,
    lat: address.lat.toNumber(),
    lng: address.lng.toNumber(),
    line2: address.line2 ?? undefined,
    gateCode: address.gateCode ?? undefined,
    serviceApproved: address.serviceApprovedAt != null,
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
    schedules: schedules.map(toScheduleResponse)
  });
}

export async function createAddressHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const input = await parseJson(req, createAddressRequestSchema);
        const firstCans =
          input.cans && input.cans.length > 0
            ? input.cans
            : [{ type: "TRASH" as const, cadence: "WEEKLY" as const, count: 1 }];
        if (cansToCadence(firstCans) === "BIWEEKLY" && !input.biweeklyAnchorDate) {
          return jsonResponse(400, {
            message: "A first pickup date is required for a biweekly schedule"
          });
        }

        // Admins may create a location on behalf of any customer by passing
        // userId; a PailPal may do so for the customers they manage; everyone
        // else always creates for themselves. Verify the target exists.
        let ownerId = auth.sub;
        if (input.userId && input.userId !== auth.sub) {
          const target = await prisma.user.findUnique({ where: { id: input.userId } });
          if (!target) {
            return jsonResponse(404, { message: "Customer not found" });
          }
          if (!(await canActForUser(auth, target.id))) {
            return jsonResponse(403, { message: "You can only add a location for your own customers" });
          }
          ownerId = target.id;
        }

        // Out-of-service-area addresses are allowed through (the UI warns the
        // customer and persists the warning on the location); we don't hard-block.

        const duplicate = await prisma.serviceAddress.findFirst({
          where: {
            userId: ownerId,
            postalCode: input.postalCode,
            line1: { equals: input.line1.trim(), mode: "insensitive" }
          }
        });
        if (duplicate) {
          throw new HttpError(409, "You've already added this address.");
        }

        // Geocode the real street address so routing uses accurate coordinates;
        // fall back to the client-provided lat/lng if the lookup is unavailable.
        const geocoded = await geocodeAddressParts({
          line1: input.line1,
          city: input.city,
          state: input.state,
          postalCode: input.postalCode
        });
        const finalLat = geocoded?.lat ?? input.lat;
        const finalLng = geocoded?.lng ?? input.lng;
        // Derive the timezone from the resolved coordinates so routing/scheduling
        // use the location's real zone regardless of what the form defaulted to.
        const timezone = timezoneForCoords(finalLat, finalLng);

        // Seed a sensible default pickup day (from the form's cans/roll-in) so a
        // new location has a schedule and a price immediately.
        const created = await prisma.serviceAddress.create({
          data: {
            userId: ownerId,
            line1: input.line1,
            line2: input.line2,
            city: input.city,
            state: input.state,
            postalCode: input.postalCode,
            lat: finalLat,
            lng: finalLng,
            timezone,
            accessNotes: input.accessNotes ?? "",
            gateCode: input.gateCode,
            canCount: cansToCanCount(firstCans),
            pickupsPerWeek: 1,
            rollIn: input.rollIn ?? true,
            isActive: input.isActive ?? true,
            // Seed the service model: a TRASH service for the first day, plus
            // PET_WASTE if dogs were requested.
            locationServices: {
              create: [
                {
                  type: "TRASH" as const,
                  options: {},
                  priceCents: null,
                  isActive: true,
                  days: {
                    create: {
                      dayOfWeek: input.pickupDayOfWeek ?? 5,
                      cadence: cansToCadence(firstCans),
                      biweeklyAnchorDate: input.biweeklyAnchorDate
                        ? new Date(input.biweeklyAnchorDate)
                        : null,
                      rollIn: input.rollIn ?? true,
                      providerSynced: input.providerSynced ?? false,
                      cans: firstCans as unknown as Prisma.InputJsonValue
                    }
                  }
                },
                ...(input.petWasteDogs && input.petWasteDogs > 0
                  ? [
                      {
                        type: "PET_WASTE" as const,
                        options: { dogs: input.petWasteDogs } as unknown as Prisma.InputJsonValue,
                        priceCents: SERVICE_FLAT_PRICING_CENTS.PET_WASTE,
                        isActive: true,
                        days: {
                          create: {
                            dayOfWeek: input.pickupDayOfWeek ?? 5,
                            cadence: cansToCadence(firstCans),
                            biweeklyAnchorDate: input.biweeklyAnchorDate
                              ? new Date(input.biweeklyAnchorDate)
                              : null,
                            rollIn: false,
                            providerSynced: false,
                            cans: [] as unknown as Prisma.InputJsonValue
                          }
                        }
                      }
                    ]
                  : [])
              ]
            }
          },
          include: { locationServices: { include: { days: true } } }
        });

        return jsonResponse(201, { address: toAddressResponse(created) });
      },
      { roles: ["CUSTOMER", "ADMIN", "PAILPAL"] }
    )(request, context)
  );
}

export async function listAddressesHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (_req, _ctx, auth) => {
        // This is the caller's own "My Locations" list — always scope to them,
        // even for admins (who are also customers here). Admin cross-user views
        // use the dedicated /ops-admin endpoints, not this one.
        const rows = await prisma.serviceAddress.findMany({
          where: { userId: auth.sub },
          orderBy: { createdAt: "desc" },
          include: { locationServices: { include: { days: true } } }
        });

        return jsonResponse(200, {
          addresses: rows.map(toAddressResponse)
        });
      },
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}

export async function updateAddressHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const addressId = req.params.addressId;
        if (!addressId) {
          return jsonResponse(400, { message: "addressId is required" });
        }

        const input = await parseJson(req, serviceAddressInputSchema.partial());
        const existing = await prisma.serviceAddress.findUnique({ where: { id: addressId } });

        if (!existing) {
          return jsonResponse(404, { message: "Address not found" });
        }

        // Self, an admin, or the PailPal who manages this customer may edit it.
        if (!(await canActForAddress(auth, existing.userId))) {
          return jsonResponse(403, { message: "Forbidden" });
        }

        // Out-of-area addresses are allowed (UI warns + persists the warning).

        // If any part of the street address changed, re-geocode so routing keeps
        // accurate coordinates. Fall back to the existing lat/lng on lookup failure.
        const addressChanged =
          input.line1 !== undefined ||
          input.city !== undefined ||
          input.state !== undefined ||
          input.postalCode !== undefined;
        let coords: { lat: number; lng: number } | undefined;
        let derivedTimezone: string | undefined;
        if (addressChanged) {
          const geocoded = await geocodeAddressParts({
            line1: input.line1 ?? existing.line1,
            city: input.city ?? existing.city,
            state: input.state ?? existing.state,
            postalCode: input.postalCode ?? existing.postalCode
          });
          if (geocoded) {
            coords = { lat: geocoded.lat, lng: geocoded.lng };
            // Re-derive the timezone whenever the address (and thus coordinates)
            // moves, so the location keeps the correct zone.
            derivedTimezone = timezoneForCoords(geocoded.lat, geocoded.lng);
          }
        }

        const updated = await prisma.serviceAddress.update({
          where: { id: addressId },
          data: {
            ...input,
            ...(coords ?? {}),
            ...(derivedTimezone ? { timezone: derivedTimezone } : {})
          },
          include: { locationServices: { include: { days: true } } }
        });

        return jsonResponse(200, { address: toAddressResponse(updated) });
      },
      { roles: ["CUSTOMER", "ADMIN", "PAILPAL"] }
    )(request, context)
  );
}

export async function deleteAddressHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const addressId = req.params.addressId;
        if (!addressId) {
          return jsonResponse(400, { message: "addressId is required" });
        }

        const existing = await prisma.serviceAddress.findUnique({ where: { id: addressId } });
        if (!existing) {
          return jsonResponse(404, { message: "Address not found" });
        }
        if (!isAdminRole(auth.role) && existing.userId !== auth.sub) {
          return jsonResponse(403, { message: "Forbidden" });
        }

        // Schedule, holds, subscriptions, and jobs cascade-delete with the address.
        await prisma.serviceAddress.delete({ where: { id: addressId } });

        return jsonResponse(200, { deleted: true });
      },
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}

// One Azure Functions route can't host two functions, so /addresses/{addressId}
// is dispatched here by method.
export async function addressByIdHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (request.method.toUpperCase() === "DELETE") {
    return deleteAddressHandler(request, context);
  }
  return updateAddressHandler(request, context);
}

// Read all services for a location (generic service model).
export async function getServicesHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const addressId = req.params.addressId;
        if (!addressId) return jsonResponse(400, { message: "addressId is required" });
        const address = await prisma.serviceAddress.findUnique({ where: { id: addressId } });
        if (!address) return jsonResponse(404, { message: "Address not found" });
        if (!(await canActForAddress(auth, address.userId))) {
          return jsonResponse(403, { message: "Forbidden" });
        }
        return jsonResponse(200, { services: await getLocationServices(addressId) });
      },
      { roles: ["CUSTOMER", "ADMIN", "PAILPAL"] }
    )(request, context)
  );
}

// Replace the whole set of services for a location (service-first model). Writes
// the new model and dual-writes the legacy ServiceSchedule via projection.
export async function upsertServicesHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const addressId = req.params.addressId;
        if (!addressId) return jsonResponse(400, { message: "addressId is required" });
        const address = await prisma.serviceAddress.findUnique({ where: { id: addressId } });
        if (!address) return jsonResponse(404, { message: "Address not found" });
        if (!(await canActForAddress(auth, address.userId))) {
          return jsonResponse(403, { message: "Forbidden" });
        }

        const { services } = await parseJson(req, servicesUpdateSchema);
        // A biweekly day needs a first-visit anchor. Trash cadence derives from
        // its cans; other services use the day's explicit cadence.
        const biweeklyMissingAnchor = services.some((s) =>
          s.days.some((d) => {
            const cans = d.cans ?? [];
            const biweekly =
              s.type === "TRASH"
                ? cans.length > 0 && cansToCadence(cans) === "BIWEEKLY"
                : d.cadence === "BIWEEKLY";
            return biweekly && !d.biweeklyAnchorDate;
          })
        );
        if (biweeklyMissingAnchor) {
          return jsonResponse(400, {
            message: "A first visit date is required for every biweekly day"
          });
        }

        const saved = await applyLocationServices(addressId, services);
        return jsonResponse(200, { services: saved });
      },
      { roles: ["CUSTOMER", "ADMIN", "PAILPAL"] }
    )(request, context)
  );
}

// Customer/admin: run the trash-provider lookup for their own location and
// return the suggestion (streams) so the UI can offer the verify-pickups sync.
// Always re-fetches (bypasses the cache) so "sync" reflects current provider data.
export async function connectProviderHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const addressId = req.params.addressId;
        if (!addressId) {
          return jsonResponse(400, { message: "addressId is required" });
        }
        const address = await prisma.serviceAddress.findUnique({ where: { id: addressId } });
        if (!address) {
          return jsonResponse(404, { message: "Address not found" });
        }
        if (!isAdminRole(auth.role) && address.userId !== auth.sub) {
          return jsonResponse(403, { message: "Forbidden" });
        }
        const suggestion = await lookupPickupSchedule(
          {
            line1: address.line1,
            city: address.city,
            state: address.state,
            postalCode: address.postalCode
          },
          { force: true }
        );
        return jsonResponse(200, pickupScheduleSuggestionSchema.parse(suggestion));
      },
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}

export async function createHoldHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const addressId = req.params.addressId;
        if (!addressId) {
          return jsonResponse(400, { message: "addressId is required" });
        }

        const address = await prisma.serviceAddress.findUnique({ where: { id: addressId } });
        if (!address) {
          return jsonResponse(404, { message: "Address not found" });
        }

        if (!isAdminRole(auth.role) && address.userId !== auth.sub) {
          return jsonResponse(403, { message: "Forbidden" });
        }

        const input = await parseJson(req, serviceHoldInputSchema);
        if (new Date(input.endDate) < new Date(input.startDate)) {
          return jsonResponse(400, { message: "endDate must be greater than or equal to startDate" });
        }

        const created = await prisma.serviceHold.create({
          data: {
            serviceAddressId: addressId,
            startDate: new Date(input.startDate),
            endDate: new Date(input.endDate),
            reason: input.reason
          }
        });

        const response = serviceHoldSchema.parse({
          id: created.id,
          serviceAddressId: created.serviceAddressId,
          startDate: created.startDate.toISOString(),
          endDate: created.endDate.toISOString(),
          reason: created.reason,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString()
        });

        return jsonResponse(201, { hold: response });
      },
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}

// Azure Functions disallows two functions sharing one route, even across
// methods, so /addresses is registered once and dispatched here by method.
export async function addressesRootHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (request.method.toUpperCase() === "GET") {
    return listAddressesHandler(request, context);
  }
  return createAddressHandler(request, context);
}

export async function addressHoldsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  if (request.method.toUpperCase() === "GET") {
    return listHoldsHandler(request, context);
  }
  return createHoldHandler(request, context);
}

export async function listHoldsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const addressId = req.params.addressId;
        if (!addressId) {
          return jsonResponse(400, { message: "addressId is required" });
        }

        const address = await prisma.serviceAddress.findUnique({ where: { id: addressId } });
        if (!address) {
          return jsonResponse(404, { message: "Address not found" });
        }

        if (!isAdminRole(auth.role) && address.userId !== auth.sub) {
          return jsonResponse(403, { message: "Forbidden" });
        }

        const holds = await prisma.serviceHold.findMany({
          where: { serviceAddressId: addressId },
          orderBy: { startDate: "desc" }
        });

        return jsonResponse(200, {
          holds: holds.map((hold: any) =>
            serviceHoldSchema.parse({
              id: hold.id,
              serviceAddressId: hold.serviceAddressId,
              startDate: hold.startDate.toISOString(),
              endDate: hold.endDate.toISOString(),
              reason: hold.reason,
              createdAt: hold.createdAt.toISOString(),
              updatedAt: hold.updatedAt.toISOString()
            })
          )
        });
      },
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}
