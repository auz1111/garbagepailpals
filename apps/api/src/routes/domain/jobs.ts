import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { customerHistoryResponseSchema, serviceJobsResponseSchema } from "@gpp/shared";
import { handleOptions, jsonResponse, withErrorBoundary } from "../../lib/http";
import { withAuth } from "../../lib/withAuth";
import { withEntitlement } from "../../lib/withEntitlement";
import { occurrenceId, projectServiceCalendar } from "../../services/serviceCalendar";

export async function upcomingJobsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      withEntitlement(async (_req, _ctx, auth) => {
        const now = new Date();
        const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        // The calendar is computed on demand from the customer's schedule + hauler
        // data — there are no pre-generated job rows. Admins see every location;
        // customers see only their own.
        const occurrences = await projectServiceCalendar(now, {
          userId: auth.role === "ADMIN" ? undefined : auth.sub,
          throughDate: in30Days
        });

        const response = serviceJobsResponseSchema.parse({
          jobs: occurrences.map((o) => ({
            id: occurrenceId(o),
            serviceAddressId: o.serviceAddressId,
            subscriptionId: o.subscriptionId,
            scheduledDate: o.scheduledDate.toISOString(),
            type: o.type,
            status: o.status,
            completedAt: null,
            photoBlobPath: null,
            failureReason: null,
            shiftedFromDate: o.shiftedFromDate?.toISOString() ?? null,
            shiftReason: o.shiftReason ?? null
          }))
        });

        return jsonResponse(200, response);
      }),
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}

export async function historyJobsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      withEntitlement(async (_req, _ctx, auth) => {
        const now = new Date();

        // History is the record of real visits: the customer's own past route
        // stops, with full detail (what was done, the exact cans, the operator's
        // verification photos, and where it happened) for a rich per-stop view.
        const stops = await prisma.routeStop.findMany({
          where: {
            route: { serviceDate: { lt: now } },
            ...(auth.role === "ADMIN" ? {} : { serviceAddress: { userId: auth.sub } })
          },
          orderBy: { route: { serviceDate: "desc" } },
          take: 60,
          include: {
            route: { select: { serviceDate: true, operator: { select: { name: true } } } },
            serviceAddress: {
              select: { line1: true, city: true, state: true, postalCode: true, lat: true, lng: true }
            }
          }
        });

        const response = customerHistoryResponseSchema.parse({
          stops: stops.map((stop) => ({
            id: stop.id,
            serviceDate: stop.route.serviceDate.toISOString(),
            servicedAt: stop.servicedAt?.toISOString() ?? null,
            status: stop.status,
            jobTypes: stop.jobTypes.split(",").filter(Boolean),
            cans: (stop.cans as unknown as any[]) ?? [],
            canCount: stop.canCount,
            petWasteDogs: stop.petWasteDogs,
            failureReason: stop.failureReason ?? null,
            line1: stop.serviceAddress.line1,
            city: stop.serviceAddress.city,
            state: stop.serviceAddress.state,
            postalCode: stop.serviceAddress.postalCode,
            lat: stop.serviceAddress.lat ? Number(stop.serviceAddress.lat) : 0,
            lng: stop.serviceAddress.lng ? Number(stop.serviceAddress.lng) : 0,
            operatorName: stop.route.operator?.name ?? null,
            verification: (stop.serviceVerification as unknown as any[]) ?? []
          }))
        });

        return jsonResponse(200, response);
      }),
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}
