import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { operatorZonesResponseSchema, operatorZonesUpdateSchema } from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";

async function myZonesResponse(operatorId: string) {
  const [zones, served] = await Promise.all([
    prisma.zone.findMany({ orderBy: { name: "asc" } }),
    prisma.userZone.findMany({ where: { userId: operatorId, serves: true }, select: { zoneId: true } })
  ]);
  const servedIds = new Set(served.map((s) => s.zoneId));
  return operatorZonesResponseSchema.parse({
    zones: zones.map((z) => ({
      id: z.id,
      name: z.name,
      city: z.city,
      state: z.state,
      serves: servedIds.has(z.id)
    }))
  });
}

// GET the zones this operator can serve (with current selections) / PUT to set
// which zones they serve. An operator only appears for assignment in zones they
// serve (see the available-operators filter).
export async function operatorZonesHandler(
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
        if (req.method === "PUT") {
          // Only a plain operator manages their own serviceable zones. A
          // pro-operator's zones are granted by a super admin (and doubling as
          // their admin scope), so they must not self-edit them here.
          if (auth.role !== "OPERATOR") {
            throw new HttpError(403, "Your service zones are managed by an administrator.");
          }
          const { zoneIds } = await parseJson(req, operatorZonesUpdateSchema);
          const unique = [...new Set(zoneIds)];
          // Only keep grants that reference real zones.
          const valid = unique.length
            ? (
                await prisma.zone.findMany({
                  where: { id: { in: unique } },
                  select: { id: true }
                })
              ).map((z) => z.id)
            : [];
          await prisma.$transaction([
            prisma.userZone.deleteMany({ where: { userId: auth.sub } }),
            prisma.userZone.createMany({
              data: valid.map((zoneId) => ({ userId: auth.sub, zoneId, serves: true }))
            })
          ]);
        }
        return jsonResponse(200, await myZonesResponse(auth.sub));
      },
      { roles: ["OPERATOR", "ADMIN"] }
    )(request, context)
  );
}
