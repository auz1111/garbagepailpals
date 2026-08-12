import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import {
  adminLocationNeighborhoodUpdateSchema,
  adminLocationsResponseSchema,
  neighborhoodCreateSchema,
  neighborhoodUpdateSchema,
  neighborhoodsResponseSchema,
  zonesResponseSchema
} from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";
import { allowedZoneIds } from "../lib/zoneScope";

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
      isTest: n.isTest,
      zoneId: n.zoneId,
      locationCount: n._count.addresses
    }))
  });
}

// GET zones the caller may administer (super admin: all; pro operator: granted).
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
      async (_req, _ctx, auth) => {
        const allowed = await allowedZoneIds(auth);
        const rows = await prisma.zone.findMany({
          where: allowed === "ALL" ? {} : { id: { in: allowed } },
          orderBy: { name: "asc" },
          include: { _count: { select: { neighborhoods: true } } }
        });
        return jsonResponse(
          200,
          zonesResponseSchema.parse({
            zones: rows.map((z) => ({
              id: z.id,
              name: z.name,
              city: z.city,
              state: z.state,
              neighborhoodCount: z._count.neighborhoods
            }))
          })
        );
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
              isTest: input.isTest ?? false
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
            ...(input.isTest !== undefined ? { isTest: input.isTest } : {})
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
      async () => {
        const rows = await prisma.serviceAddress.findMany({
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          include: { user: { select: { name: true } } }
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
              neighborhoodId: a.neighborhoodId
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
