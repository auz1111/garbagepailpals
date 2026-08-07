import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { adminIncidentFeedSchema, adminRuntimeMetricsSchema } from "@gpp/shared";
import { handleOptions, jsonResponse, withErrorBoundary } from "../lib/http";
import { getRuntimeMetricsSnapshot } from "../lib/runtimeMetrics";
import { buildAdminIncidentFeed } from "../services/incidents";
import { withAuth } from "../lib/withAuth";

export async function adminRuntimeMetricsHandler(
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
        const response = adminRuntimeMetricsSchema.parse(getRuntimeMetricsSnapshot());
        return jsonResponse(200, response);
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

export async function adminIncidentsHandler(
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
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const staleWebhookThreshold = new Date(now.getTime() - 15 * 60 * 1000);

        const [failedJobs, failedNotifications, staleWebhooks] = await Promise.all([
          prisma.serviceJob.findMany({
            where: {
              status: "FAILED",
              updatedAt: { gte: weekAgo }
            },
            orderBy: { updatedAt: "desc" },
            take: 40,
            select: {
              id: true,
              failureReason: true,
              updatedAt: true
            }
          }),
          prisma.auditLog.findMany({
            where: {
              createdAt: { gte: weekAgo },
              action: {
                in: ["notification.reminder.failed", "notification.overdue.failed"]
              }
            },
            orderBy: { createdAt: "desc" },
            take: 40,
            select: {
              id: true,
              action: true,
              entityType: true,
              entityId: true,
              metadata: true,
              createdAt: true
            }
          }),
          prisma.webhookEvent.findMany({
            where: {
              createdAt: { gte: weekAgo, lte: staleWebhookThreshold },
              processedAt: null
            },
            orderBy: { createdAt: "desc" },
            take: 40,
            select: {
              id: true,
              provider: true,
              externalEventId: true,
              createdAt: true
            }
          })
        ]);

        const response = adminIncidentFeedSchema.parse(
          buildAdminIncidentFeed({
            now,
            failedJobs,
            failedNotifications,
            staleWebhooks,
            maxItems: 75
          })
        );

        return jsonResponse(200, response);
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}
