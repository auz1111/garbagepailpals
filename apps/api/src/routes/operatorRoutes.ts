import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { Prisma } from "@prisma/client";
import { operatorRoutesResponseSchema, operatorStopServiceSchema } from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
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
        if (route.status === "CANCELLED") {
          throw new HttpError(409, "This route was cancelled by dispatch.");
        }
        if (route.status === "ASSIGNED") {
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

// The operator declines an assigned route before accepting it. The route is
// removed (its stops cascade), freeing those locations to be reassigned by
// dispatch or rebuilt. An already-accepted route is locked and can't be declined.
export async function operatorDeclineRouteHandler(
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
        if (route.status === "ACCEPTED") {
          throw new HttpError(409, "You've already accepted this route — it can no longer be declined.");
        }
        if (route.status === "COMPLETED") {
          throw new HttpError(409, "This route is already completed.");
        }
        await prisma.dailyRoute.delete({ where: { id: routeId } });
        return jsonResponse(200, await myRoutesResponse(auth.sub));
      },
      { roles: ["OPERATOR", "ADMIN"] }
    )(request, context)
  );
}

// Operator marks a stop serviced (or un-marks it). The route auto-completes when
// every stop is serviced. Only allowed once the route is accepted.
export async function operatorServiceStopHandler(
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
        const { addressId, serviced, verification } = await parseJson(req, operatorStopServiceSchema);
        const route = await prisma.dailyRoute.findUnique({ where: { id: routeId } });
        if (!route || route.operatorId !== auth.sub) {
          throw new HttpError(404, "Route not found");
        }
        if (route.status === "CANCELLED") {
          throw new HttpError(409, "This route was cancelled by dispatch.");
        }
        if (route.status === "ASSIGNED") {
          throw new HttpError(409, "Accept the route before marking stops serviced.");
        }

        await prisma.routeStop.updateMany({
          where: { routeId, serviceAddressId: addressId },
          data: {
            // The stop is the single record of real work: SERVICED once completed,
            // back to PENDING if un-marked.
            status: serviced ? "SERVICED" : "PENDING",
            servicedAt: serviced ? new Date() : null,
            // Store the completed checklist when marking serviced; clear it when
            // un-marking so a re-verify starts fresh.
            serviceVerification: serviced
              ? ((verification ?? []) as unknown as Prisma.InputJsonValue)
              : ([] as unknown as Prisma.InputJsonValue)
          }
        });

        // A route is COMPLETED once every stop is serviced; otherwise it's ACCEPTED.
        const stops = await prisma.routeStop.findMany({
          where: { routeId },
          select: { servicedAt: true }
        });
        const allServiced = stops.length > 0 && stops.every((s) => s.servicedAt !== null);
        await prisma.dailyRoute.update({
          where: { id: routeId },
          data: { status: allServiced ? "COMPLETED" : "ACCEPTED" }
        });

        return jsonResponse(200, await myRoutesResponse(auth.sub));
      },
      { roles: ["OPERATOR", "ADMIN"] }
    )(request, context)
  );
}
