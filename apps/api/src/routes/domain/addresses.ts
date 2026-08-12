import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import {
  createAddressRequestSchema,
  scheduleUpdateSchema,
  serviceAddressInputSchema,
  serviceAddressSchema,
  serviceHoldInputSchema,
  serviceHoldSchema
} from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../../lib/http";
import { withAuth } from "../../lib/withAuth";
import { geocodeAddressParts } from "../../services/geocoding";
import { timezoneForCoords } from "../../lib/timezone";
import { isPostalServiceable } from "../../lib/serviceArea";

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
  createdAt: Date;
  updatedAt: Date;
};

function toScheduleResponse(row: ScheduleRow) {
  return {
    id: row.id,
    serviceAddressId: row.serviceAddressId,
    dayOfWeek: row.pickupDayOfWeek,
    cadence: row.cadence,
    biweeklyAnchorDate: row.biweeklyAnchorDate?.toISOString(),
    canCount: row.canCount,
    rollIn: row.rollIn,
    glassRecycling: row.glassRecycling,
    petWasteDogs: row.petWasteDogs,
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
  createdAt: Date;
  updatedAt: Date;
  schedules?: ScheduleRow[];
}) {
  return serviceAddressSchema.parse({
    ...address,
    lat: address.lat.toNumber(),
    lng: address.lng.toNumber(),
    line2: address.line2 ?? undefined,
    gateCode: address.gateCode ?? undefined,
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
    schedules: (address.schedules ?? [])
      .slice()
      .sort((a, b) => a.pickupDayOfWeek - b.pickupDayOfWeek)
      .map(toScheduleResponse)
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
        if (input.cadence === "BIWEEKLY" && !input.biweeklyAnchorDate) {
          return jsonResponse(400, {
            message: "A first pickup date is required for a biweekly schedule"
          });
        }

        if (!(await isPostalServiceable(input.postalCode, { includeTest: true }))) {
          return jsonResponse(400, { message: "Address is outside the service area" });
        }

        const duplicate = await prisma.serviceAddress.findFirst({
          where: {
            userId: auth.sub,
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

        // Seed a sensible default pickup day (Tuesday, weekly) from the form's
        // cans/roll-in, so a new location has a schedule and a price immediately.
        const created = await prisma.serviceAddress.create({
          data: {
            userId: auth.sub,
            line1: input.line1,
            line2: input.line2,
            city: input.city,
            state: input.state,
            postalCode: input.postalCode,
            lat: finalLat,
            lng: finalLng,
            timezone,
            accessNotes: input.accessNotes,
            gateCode: input.gateCode,
            canCount: input.canCount,
            pickupsPerWeek: 1,
            rollIn: input.rollIn ?? true,
            isActive: input.isActive ?? true,
            schedules: {
              create: {
                pickupDayOfWeek: input.pickupDayOfWeek ?? 2,
                cadence: input.cadence ?? "WEEKLY",
                biweeklyAnchorDate: input.biweeklyAnchorDate
                  ? new Date(input.biweeklyAnchorDate)
                  : null,
                canCount: input.canCount,
                rollIn: input.rollIn ?? true,
                glassRecycling: input.glassRecycling ?? false,
                petWasteDogs: input.petWasteDogs ?? 0
              }
            }
          },
          include: { schedules: true }
        });

        return jsonResponse(201, { address: toAddressResponse(created) });
      },
      { roles: ["CUSTOMER", "ADMIN"] }
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
        const rows = await prisma.serviceAddress.findMany({
          where: auth.role === "ADMIN" ? undefined : { userId: auth.sub },
          orderBy: { createdAt: "desc" },
          include: { schedules: true }
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

        if (auth.role !== "ADMIN" && existing.userId !== auth.sub) {
          return jsonResponse(403, { message: "Forbidden" });
        }

        if (input.postalCode && !(await isPostalServiceable(input.postalCode, { includeTest: true }))) {
          return jsonResponse(400, { message: "Address is outside the service area" });
        }

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
          include: { schedules: true }
        });

        return jsonResponse(200, { address: toAddressResponse(updated) });
      },
      { roles: ["CUSTOMER", "ADMIN"] }
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
        if (auth.role !== "ADMIN" && existing.userId !== auth.sub) {
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

export async function upsertScheduleHandler(
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

        if (auth.role !== "ADMIN" && address.userId !== auth.sub) {
          return jsonResponse(403, { message: "Forbidden" });
        }

        const { days } = await parseJson(req, scheduleUpdateSchema);
        const biweeklyMissingAnchor = days.some(
          (day) => day.cadence === "BIWEEKLY" && !day.biweeklyAnchorDate
        );
        if (biweeklyMissingAnchor) {
          return jsonResponse(400, {
            message: "A first pickup date is required for every biweekly day"
          });
        }

        // Replace the whole set of pickup days for this location, and keep
        // pickups-per-week (a legacy convenience field) in sync with the count.
        const [, , rows] = await prisma.$transaction([
          prisma.serviceSchedule.deleteMany({ where: { serviceAddressId: addressId } }),
          prisma.serviceSchedule.createMany({
            data: days.map((day) => ({
              serviceAddressId: addressId,
              pickupDayOfWeek: day.dayOfWeek,
              cadence: day.cadence,
              biweeklyAnchorDate: day.biweeklyAnchorDate ? new Date(day.biweeklyAnchorDate) : null,
              canCount: day.canCount,
              rollIn: day.rollIn,
              glassRecycling: day.glassRecycling ?? false,
              petWasteDogs: day.petWasteDogs ?? 0
            }))
          }),
          prisma.serviceSchedule.findMany({ where: { serviceAddressId: addressId } })
        ]);

        await prisma.serviceAddress.update({
          where: { id: addressId },
          data: { pickupsPerWeek: days.length }
        });

        return jsonResponse(200, {
          schedules: rows
            .slice()
            .sort((a, b) => a.pickupDayOfWeek - b.pickupDayOfWeek)
            .map(toScheduleResponse)
        });
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

        if (auth.role !== "ADMIN" && address.userId !== auth.sub) {
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

        if (auth.role !== "ADMIN" && address.userId !== auth.sub) {
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
