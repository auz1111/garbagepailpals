import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { serviceJobsResponseSchema } from "@gpp/shared";
import { handleOptions, jsonResponse, withErrorBoundary } from "../../lib/http";
import { withAuth } from "../../lib/withAuth";
import { withEntitlement } from "../../lib/withEntitlement";
import { runNightlyJobGeneration } from "../../services/scheduler";

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
          jobs: jobs.map((job: any) => ({
            id: job.id,
            serviceAddressId: job.serviceAddressId,
            subscriptionId: job.subscriptionId,
            scheduledDate: job.scheduledDate.toISOString(),
            type: job.type,
            status: job.status,
            completedAt: job.completedAt?.toISOString() ?? null,
            photoBlobPath: job.photoBlobPath ?? null,
            failureReason: job.failureReason ?? null,
            shiftedFromDate: job.shiftedFromDate?.toISOString() ?? null,
            shiftReason: job.shiftReason ?? null
          }))
        });

        return jsonResponse(200, response);
      }),
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}

// Manually triggers job generation ("run scheduler now"), bypassing the 2am
// gate. Customers generate only their own jobs; admins generate for everyone.
export async function generateJobsHandler(
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
        const result = await runNightlyJobGeneration(new Date(), {
          force: true,
          userId: auth.role === "ADMIN" ? undefined : auth.sub
        });

        return jsonResponse(200, { created: result.created, pruned: result.pruned });
      },
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
          jobs: jobs.map((job: any) => ({
            id: job.id,
            serviceAddressId: job.serviceAddressId,
            subscriptionId: job.subscriptionId,
            scheduledDate: job.scheduledDate.toISOString(),
            type: job.type,
            status: job.status,
            completedAt: job.completedAt?.toISOString() ?? null,
            photoBlobPath: job.photoBlobPath ?? null,
            failureReason: job.failureReason ?? null,
            shiftedFromDate: job.shiftedFromDate?.toISOString() ?? null,
            shiftReason: job.shiftReason ?? null
          }))
        });

        return jsonResponse(200, response);
      }),
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}
