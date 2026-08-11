import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { operatorRoutesResponseSchema } from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";
import {
  DAILY_ROUTE_INCLUDE,
  serializeDailyRoute,
  todayServiceDate,
  type DailyRouteRow
} from "./adminRoutes";

async function myRoutesResponse(operatorId: string) {
  const now = new Date();
  const routes = await prisma.dailyRoute.findMany({
    where: { operatorId, serviceDate: todayServiceDate(now) },
    include: DAILY_ROUTE_INCLUDE,
    orderBy: { createdAt: "asc" }
  });
  return operatorRoutesResponseSchema.parse({
    date: now.toISOString(),
    routes: routes.map((r) => serializeDailyRoute(r as unknown as DailyRouteRow))
  });
}

// The routes assigned to the signed-in operator for today.
export async function operatorRoutesHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (_req, _ctx, auth) => jsonResponse(200, await myRoutesResponse(auth.sub)),
      { roles: ["OPERATOR", "ADMIN"] }
    )(request, context)
  );
}

// The operator accepts a route, locking it to them. Its locations are already
// exclusive to this route (one operator per location), so accepting simply
// finalizes it — an accepted route can no longer be removed/reassigned.
export async function operatorAcceptRouteHandler(
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
        const routeId = req.params.routeId;
        if (!routeId) {
          throw new HttpError(400, "routeId is required");
        }
        const route = await prisma.dailyRoute.findUnique({ where: { id: routeId } });
        if (!route || route.operatorId !== auth.sub) {
          throw new HttpError(404, "Route not found");
        }
        if (route.status !== "ACCEPTED") {
          await prisma.dailyRoute.update({
            where: { id: routeId },
            data: { status: "ACCEPTED", acceptedAt: new Date() }
          });
        }
        return jsonResponse(200, await myRoutesResponse(auth.sub));
      },
      { roles: ["OPERATOR", "ADMIN"] }
    )(request, context)
  );
}
