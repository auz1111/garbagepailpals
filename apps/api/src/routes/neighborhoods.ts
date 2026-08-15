import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { z } from "zod";
import {
  adminLocationNeighborhoodUpdateSchema,
  adminLocationsResponseSchema,
  haulerCoverageResponseSchema,
  isSuperAdminRole,
  locationApprovalSchema,
  locationServicesMonthlyCents,
  neighborhoodCreateSchema,
  neighborhoodUpdateSchema,
  neighborhoodsResponseSchema,
  pickupScheduleSuggestionSchema,
  scheduleCanSchema,
  type ScheduleCan,
  type ServicePricing,
  type ServiceType,
  zoneCreateSchema,
  zoneUpdateSchema,
  zonesResponseSchema
} from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";
import { allowedZoneIds } from "../lib/zoneScope";
import {
  describeProviders,
  getHaulerCoverage,
  haulerAddressHash,
  lookupPickupSchedule,
  refreshProviderUpcoming
} from "../services/haulerSchedule";
import { schedulesFromServices } from "../services/locationServices";

// A location's monthly total (day-centric, matches billing).
function addressMonthly(
  services: { type: string; options: unknown; days: { dayOfWeek: number; cadence: string; rollIn: boolean; cans: unknown }[] }[]
): number {
  const pricing: ServicePricing[] = services.map((s) => ({
    type: s.type as ServiceType,
    days: s.days.map((d) => ({
      dayOfWeek: d.dayOfWeek,
      cadence: d.cadence as "WEEKLY" | "BIWEEKLY",
      cans: cansArraySchema.safeParse(d.cans).success
        ? (cansArraySchema.parse(d.cans) as ScheduleCan[])
        : [],
      rollIn: d.rollIn
    }))
  }));
  return locationServicesMonthlyCents(pricing);
}

const cansArraySchema = z.array(scheduleCanSchema);
function parseCans(cans: unknown): ScheduleCan[] {
  const parsed = cansArraySchema.safeParse(cans);
  return parsed.success ? parsed.data : [];
}

async function zonesList(userId: string, role: string) {
  const allowed = isSuperAdminRole(role)
    ? "ALL"
    : (await prisma.userZone.findMany({ where: { userId }, select: { zoneId: true } })).map(
        (r) => r.zoneId
      );
  const rows = await prisma.zone.findMany({
    where: allowed === "ALL" ? {} : { id: { in: allowed } },
    orderBy: { name: "asc" },
    include: { _count: { select: { neighborhoods: true } } }
  });
  return zonesResponseSchema.parse({
    zones: rows.map((z) => ({
      id: z.id,
      name: z.name,
      city: z.city,
      state: z.state,
      isTest: z.isTest,
      neighborhoodCount: z._count.neighborhoods
    }))
  });
}

async function neighborhoodList() {
  const rows = await prisma.neighborhood.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { addresses: true } } }
  });
  return neighborhoodsResponseSchema.parse({
    neighborhoods: rows.map((n) => ({
      id: n.id,
      name: n.name,
      city: n.city,
      state: n.state,
      zipCodes: n.zipCodes,
      zoneId: n.zoneId,
      locationCount: n._count.addresses
    }))
  });
}

// GET zones the caller may administer (super admin: all; pro operator: granted).
// POST creates a zone (super admin only).
export async function adminZonesHandler(
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
        if (req.method === "POST") {
          if (!isSuperAdminRole(auth.role)) {
            throw new HttpError(403, "Only a super admin can manage zones.");
          }
          const input = await parseJson(req, zoneCreateSchema);
          const existing = await prisma.zone.findUnique({ where: { name: input.name } });
          if (existing) {
            throw new HttpError(409, "A zone with that name already exists.");
          }
          await prisma.zone.create({
            data: { name: input.name, city: input.city ?? null, state: input.state ?? null }
          });
        }
        return jsonResponse(200, await zonesList(auth.sub, auth.role));
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// PATCH rename / DELETE a zone (super admin only).
export async function adminZoneByIdHandler(
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
        if (!isSuperAdminRole(auth.role)) {
          throw new HttpError(403, "Only a super admin can manage zones.");
        }
        const id = req.params.zoneId;
        if (!id) {
          throw new HttpError(400, "zoneId is required");
        }
        if (req.method === "DELETE") {
          // Neighborhoods keep their data; their zoneId is nulled (schema FK).
          await prisma.zone.delete({ where: { id } });
          return jsonResponse(200, await zonesList(auth.sub, auth.role));
        }
        const input = await parseJson(req, zoneUpdateSchema);
        if (input.name) {
          const clash = await prisma.zone.findUnique({ where: { name: input.name } });
          if (clash && clash.id !== id) {
            throw new HttpError(409, "A zone with that name already exists.");
          }
        }
        await prisma.zone.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.city !== undefined ? { city: input.city } : {}),
            ...(input.state !== undefined ? { state: input.state } : {}),
            ...(input.isTest !== undefined ? { isTest: input.isTest } : {})
          }
        });
        return jsonResponse(200, await zonesList(auth.sub, auth.role));
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// Super-admin overview of which haulers are wired up and which service areas
// have working lookups (configured + empirically matched).
export async function adminHaulerCoverageHandler(
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
        if (!isSuperAdminRole(auth.role)) {
          throw new HttpError(403, "Only a super admin can view hauler coverage.");
        }
        const coverage = await getHaulerCoverage();
        return jsonResponse(200, haulerCoverageResponseSchema.parse(coverage));
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// Force-refresh the cached schedules for every address matched to one provider,
// so its health status (and holiday shifts) reflect the latest hauler data.
export async function adminRefreshProviderHandler(
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
        if (!isSuperAdminRole(auth.role)) {
          throw new HttpError(403, "Only a super admin can refresh provider caches.");
        }
        const providerId = req.params.providerId;
        if (!providerId) {
          throw new HttpError(400, "providerId is required");
        }
        if (!describeProviders().some((p) => p.id === providerId)) {
          throw new HttpError(404, "Unknown provider");
        }

        // Targeted refresh: re-pull each matched address's schedule from ONLY
        // this provider (via its stored externalId), throttled — no re-matching
        // and no calls to other providers.
        const { refreshed } = await refreshProviderUpcoming(providerId);
        return jsonResponse(200, { ok: true, refreshed });
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// GET list / POST create.
export async function adminNeighborhoodsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req) => {
        if (req.method === "POST") {
          const input = await parseJson(req, neighborhoodCreateSchema);
          const existing = await prisma.neighborhood.findUnique({ where: { name: input.name } });
          if (existing) {
            throw new HttpError(409, "A neighborhood with that name already exists.");
          }
          await prisma.neighborhood.create({
            data: {
              name: input.name,
              city: input.city ?? null,
              state: input.state ?? null,
              zipCodes: input.zipCodes ?? [],
              zoneId: input.zoneId ?? null
            }
          });
          return jsonResponse(201, await neighborhoodList());
        }
        return jsonResponse(200, await neighborhoodList());
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// PATCH rename / DELETE.
export async function adminNeighborhoodByIdHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req) => {
        const id = req.params.neighborhoodId;
        if (!id) {
          throw new HttpError(400, "neighborhoodId is required");
        }
        if (req.method === "DELETE") {
          await prisma.neighborhood.delete({ where: { id } });
          return jsonResponse(200, await neighborhoodList());
        }
        const input = await parseJson(req, neighborhoodUpdateSchema);
        if (input.name) {
          const clash = await prisma.neighborhood.findUnique({ where: { name: input.name } });
          if (clash && clash.id !== id) {
            throw new HttpError(409, "A neighborhood with that name already exists.");
          }
        }
        await prisma.neighborhood.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.city !== undefined ? { city: input.city } : {}),
            ...(input.state !== undefined ? { state: input.state } : {}),
            ...(input.zipCodes !== undefined ? { zipCodes: input.zipCodes } : {}),
            ...(input.zoneId !== undefined ? { zoneId: input.zoneId } : {})
          }
        });
        return jsonResponse(200, await neighborhoodList());
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// GET all locations (for neighborhood assignment).
export async function adminLocationsHandler(
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
        // Super admin sees every location; a pro operator only sees locations in
        // the zones granted to them.
        const scope = await allowedZoneIds(auth);
        const rows = await prisma.serviceAddress.findMany({
          where: {
            isActive: true,
            ...(scope === "ALL" ? {} : { neighborhood: { zoneId: { in: scope } } })
          },
          orderBy: { createdAt: "desc" },
          include: {
            user: { select: { name: true } },
            neighborhood: { include: { zone: true } },
            locationServices: { include: { days: true } },
            subscriptions: {
              where: { status: { in: ["ACTIVE", "TRIALING"] } },
              select: { id: true },
              take: 1
            }
          }
        });

        // Batch-resolve the connected trash provider for each location from the
        // lookup cache (keyed by normalized address hash).
        const hashOf = (a: { line1: string; city: string; state: string; postalCode: string }) =>
          haulerAddressHash({ line1: a.line1, city: a.city, state: a.state, postalCode: a.postalCode });
        const linkRows = rows.length
          ? await prisma.haulerScheduleLookup
              .findMany({
                where: { matched: true, addressHash: { in: rows.map(hashOf) } },
                select: { addressHash: true, provider: true }
              })
              .catch(() => [])
          : [];
        const providerByHash = new Map(linkRows.map((r) => [r.addressHash, r.provider]));
        const providers = describeProviders();
        const labelFor = (id: string) => providers.find((p) => p.id === id)?.label ?? id;

        return jsonResponse(
          200,
          adminLocationsResponseSchema.parse({
            locations: rows.map((a) => {
              const provider = providerByHash.get(hashOf(a)) ?? null;
              const schedules = schedulesFromServices(a.id, a.locationServices, a.updatedAt);
              return {
                id: a.id,
                line1: a.line1,
                city: a.city,
                state: a.state,
                postalCode: a.postalCode,
                customerName: a.user.name,
                userId: a.userId,
                neighborhoodId: a.neighborhoodId,
                neighborhoodName: a.neighborhood?.name ?? null,
                zoneId: a.neighborhood?.zoneId ?? null,
                zoneName: a.neighborhood?.zone?.name ?? null,
                canCount: a.canCount,
                glassRecycling: schedules.some((s) => s.glassRecycling),
                petWaste: schedules.some((s) => s.petWasteDogs > 0),
                serviceApproved: a.serviceApprovedAt != null,
                billed: a.subscriptions.length > 0,
                pickupDays: schedules.map((s) => s.pickupDayOfWeek).sort((x, y) => x - y),
                haulerProvider: provider,
                haulerProviderLabel: provider ? labelFor(provider) : null,
                providerSynced: schedules.some((s) => s.providerSynced),
                monthlyCents: addressMonthly(a.locationServices)
              };
            })
          })
        );
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// Run (or re-run) the hauler lookup for an existing location and seed the cache
// so the scheduler can apply holiday shifts. Useful for locations added before a
// hauler provider covered their area. Returns the resulting suggestion.
export async function adminConnectHaulerHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req) => {
        const addressId = req.params.addressId;
        if (!addressId) {
          throw new HttpError(400, "addressId is required");
        }
        const address = await prisma.serviceAddress.findUnique({ where: { id: addressId } });
        if (!address) {
          throw new HttpError(404, "Address not found");
        }
        const suggestion = await lookupPickupSchedule(
          {
            line1: address.line1,
            city: address.city,
            state: address.state,
            postalCode: address.postalCode
          },
          // Connect / "Re-check provider" always re-fetches, bypassing the cache.
          { force: true }
        );
        return jsonResponse(200, pickupScheduleSuggestionSchema.parse(suggestion));
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// PATCH a location's neighborhood assignment.
export async function adminLocationByIdHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req) => {
        const addressId = req.params.addressId;
        if (!addressId) {
          throw new HttpError(400, "addressId is required");
        }
        const { neighborhoodId } = await parseJson(req, adminLocationNeighborhoodUpdateSchema);
        await prisma.serviceAddress.update({ where: { id: addressId }, data: { neighborhoodId } });
        return jsonResponse(200, { ok: true });
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// Admin approves (or revokes) a location for service. Until approved, a location
// is never routed, counted toward today's work, or job-generating — even when
// billing is active.
export async function adminLocationApprovalHandler(
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
          throw new HttpError(400, "addressId is required");
        }
        const { approved } = await parseJson(req, locationApprovalSchema);
        const existing = await prisma.serviceAddress.findUnique({ where: { id: addressId } });
        if (!existing) {
          throw new HttpError(404, "Location not found");
        }
        // A location can't be approved for service until its plan is active — the
        // customer must complete billing first.
        if (approved) {
          const activeSub = await prisma.subscription.findFirst({
            where: { serviceAddressId: addressId, status: { in: ["ACTIVE", "TRIALING"] } },
            select: { id: true }
          });
          if (!activeSub) {
            throw new HttpError(409, "Billing must be active before this location can be approved.");
          }
        }
        await prisma.serviceAddress.update({
          where: { id: addressId },
          data: {
            serviceApprovedAt: approved ? new Date() : null,
            serviceApprovedById: approved ? auth.sub : null
          }
        });
        await prisma.auditLog.create({
          data: {
            actorUserId: auth.sub,
            action: approved ? "admin.location.approved" : "admin.location.unapproved",
            entityType: "ServiceAddress",
            entityId: addressId,
            metadata: { approved }
          }
        });
        return jsonResponse(200, { ok: true, serviceApproved: approved });
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}
