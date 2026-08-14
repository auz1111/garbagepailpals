import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { serviceJobsResponseSchema } from "@gpp/shared";
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

        // History is now the record of real visits: past route stops. Each stop
        // can carry a roll-out and/or roll-in — expand it back into per-action
        // entries so the calendar/history UI keeps its familiar shape.
        const stops = await prisma.routeStop.findMany({
          where: {
            route: { serviceDate: { lt: now } },
            ...(auth.role === "ADMIN" ? {} : { serviceAddress: { userId: auth.sub } })
          },
          orderBy: { route: { serviceDate: "desc" } },
          take: 100,
          include: {
            route: { select: { serviceDate: true } },
            serviceAddress: { select: { subscriptions: { select: { id: true }, take: 1 } } }
          }
        });

        const statusMap = {
          SERVICED: "COMPLETED",
          SKIPPED: "SKIPPED",
          FAILED: "FAILED",
          PENDING: "SCHEDULED"
        } as const;

        const jobs = stops.flatMap((stop) => {
          const types = stop.jobTypes.split(",").filter(Boolean);
          const when = stop.servicedAt ?? stop.route.serviceDate;
          const subscriptionId = stop.serviceAddress.subscriptions[0]?.id ?? "";
          return types.map((type) => ({
            id: `${stop.id}:${type}`,
            serviceAddressId: stop.serviceAddressId,
            subscriptionId,
            scheduledDate: when.toISOString(),
            type: type as "CURB_OUT" | "CURB_IN",
            status: statusMap[stop.status],
            completedAt: stop.servicedAt?.toISOString() ?? null,
            photoBlobPath: null,
            failureReason: stop.failureReason ?? null,
            shiftedFromDate: null,
            shiftReason: null
          }));
        });

        const response = serviceJobsResponseSchema.parse({ jobs });

        return jsonResponse(200, response);
      }),
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}
