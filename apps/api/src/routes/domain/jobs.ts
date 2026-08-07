import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { serviceJobsResponseSchema } from "@gpp/shared";
import { handleOptions, jsonResponse, withErrorBoundary } from "../../lib/http";
import { withAuth } from "../../lib/withAuth";
import { withEntitlement } from "../../lib/withEntitlement";

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

        const jobs = await prisma.serviceJob.findMany({
          where:
            auth.role === "ADMIN"
              ? { scheduledDate: { gte: now, lte: in30Days } }
              : {
                  scheduledDate: { gte: now, lte: in30Days },
                  serviceAddress: { userId: auth.sub }
                },
          orderBy: { scheduledDate: "asc" }
        });

        const response = serviceJobsResponseSchema.parse({
          jobs: jobs.map((job) => ({
            id: job.id,
            serviceAddressId: job.serviceAddressId,
            subscriptionId: job.subscriptionId,
            scheduledDate: job.scheduledDate.toISOString(),
            type: job.type,
            status: job.status,
            completedAt: job.completedAt?.toISOString() ?? null,
            photoBlobPath: job.photoBlobPath ?? null,
            failureReason: job.failureReason ?? null
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

        const jobs = await prisma.serviceJob.findMany({
          where:
            auth.role === "ADMIN"
              ? { scheduledDate: { lt: now } }
              : {
                  scheduledDate: { lt: now },
                  serviceAddress: { userId: auth.sub }
                },
          orderBy: { scheduledDate: "desc" },
          take: 100
        });

        const response = serviceJobsResponseSchema.parse({
          jobs: jobs.map((job) => ({
            id: job.id,
            serviceAddressId: job.serviceAddressId,
            subscriptionId: job.subscriptionId,
            scheduledDate: job.scheduledDate.toISOString(),
            type: job.type,
            status: job.status,
            completedAt: job.completedAt?.toISOString() ?? null,
            photoBlobPath: job.photoBlobPath ?? null,
            failureReason: job.failureReason ?? null
          }))
        });

        return jsonResponse(200, response);
      }),
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}
