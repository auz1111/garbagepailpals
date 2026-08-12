import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import {
  addressMonthlyCents,
  adminLocationNeighborhoodUpdateSchema,
  adminLocationsResponseSchema,
  isSuperAdminRole,
  neighborhoodCreateSchema,
  neighborhoodUpdateSchema,
  neighborhoodsResponseSchema,
  zoneCreateSchema,
  zoneUpdateSchema,
  zonesResponseSchema
} from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";
import { allowedZoneIds } from "../lib/zoneScope";

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
            schedules: true
          }
        });
        return jsonResponse(
          200,
          adminLocationsResponseSchema.parse({
            locations: rows.map((a) => ({
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
              glassRecycling: a.schedules.some((s) => s.glassRecycling),
              petWaste: a.schedules.some((s) => s.petWasteDogs > 0),
              monthlyCents: addressMonthlyCents(
                a.schedules.map((s) => ({
                  dayOfWeek: s.pickupDayOfWeek,
                  canCount: s.canCount,
                  cadence: s.cadence as "WEEKLY" | "BIWEEKLY",
                  rollIn: s.rollIn,
                  glassRecycling: s.glassRecycling,
                  petWasteDogs: s.petWasteDogs
                }))
              )
            }))
          })
        );
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
