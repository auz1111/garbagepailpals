import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { operatorZoneRequestSchema, operatorZonesResponseSchema } from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";

async function myZonesResponse(operatorId: string) {
  const [zones, served, requested] = await Promise.all([
    prisma.zone.findMany({ orderBy: { name: "asc" } }),
    prisma.userZone.findMany({ where: { userId: operatorId, serves: true }, select: { zoneId: true } }),
    prisma.operatorZoneRequest.findMany({
      where: { operatorId, status: "PENDING" },
      select: { zoneId: true }
    })
  ]);
  const servedIds = new Set(served.map((s) => s.zoneId));
  const requestedIds = new Set(requested.map((r) => r.zoneId));
  return operatorZonesResponseSchema.parse({
    zones: zones.map((z) => ({
      id: z.id,
      name: z.name,
      city: z.city,
      state: z.state,
      serves: servedIds.has(z.id),
      requested: requestedIds.has(z.id)
    }))
  });
}

// GET the zones this operator serves, plus which they've requested. Operators no
// longer set their own zones — a pro-operator/super admin grants them.
export async function operatorZonesHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }
  return withErrorBoundary(context, async () =>
    withAuth(async (_req, _ctx, auth) => jsonResponse(200, await myZonesResponse(auth.sub)), {
      roles: ["OPERATOR", "ADMIN"]
    })(request, context)
  );
}

// Operator requests a zone to serve (or cancels a pending request) — mirrors the
// time-off flow. An admin approves by granting the zone.
export async function operatorZoneRequestHandler(
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
        if (auth.role !== "OPERATOR") {
          throw new HttpError(403, "Only operators request service areas.");
        }
        const { zoneId } = await parseJson(req, operatorZoneRequestSchema);
        const zone = await prisma.zone.findUnique({ where: { id: zoneId }, select: { id: true } });
        if (!zone) {
          throw new HttpError(404, "Zone not found");
        }
        const alreadyServes = await prisma.userZone.findUnique({
          where: { userId_zoneId: { userId: auth.sub, zoneId } },
          select: { serves: true }
        });
        if (alreadyServes?.serves) {
          throw new HttpError(409, "You already serve this area.");
        }
        const existing = await prisma.operatorZoneRequest.findUnique({
          where: { operatorId_zoneId: { operatorId: auth.sub, zoneId } }
        });
        if (existing && existing.status === "PENDING") {
          // Tapping a pending request again cancels it.
          await prisma.operatorZoneRequest.delete({ where: { id: existing.id } });
        } else if (existing) {
          await prisma.operatorZoneRequest.update({
            where: { id: existing.id },
            data: { status: "PENDING" }
          });
        } else {
          await prisma.operatorZoneRequest.create({
            data: { operatorId: auth.sub, zoneId, status: "PENDING" }
          });
        }
        return jsonResponse(200, await myZonesResponse(auth.sub));
      },
      { roles: ["OPERATOR", "ADMIN"] }
    )(request, context)
  );
}
