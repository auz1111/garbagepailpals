import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import {
  adminIncidentAcknowledgeRequestSchema,
  adminIncidentAcknowledgeResponseSchema,
  adminIncidentFeedSchema,
  adminRuntimeMetricsSchema
} from "@gpp/shared";
import { handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
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
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const staleWebhookThreshold = new Date(now.getTime() - 15 * 60 * 1000);

        const [failedJobs, failedNotifications, staleWebhooks, acknowledgements] = await Promise.all([
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
          }),
          prisma.auditLog.findMany({
            where: {
              action: "incident.acknowledged",
              entityType: "AdminIncident",
              createdAt: { gte: monthAgo }
            },
            orderBy: { createdAt: "desc" },
            take: 300,
            select: {
              entityId: true,
              actorUserId: true,
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
            acknowledgements: acknowledgements.map((item) => ({
              incidentId: item.entityId,
              actorUserId: item.actorUserId,
              createdAt: item.createdAt
            })),
            maxItems: 75
          })
        );

        return jsonResponse(200, response);
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

export async function adminAcknowledgeIncidentHandler(
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
        const incidentId = req.params.incidentId;
        if (!incidentId) {
          return jsonResponse(400, { message: "incidentId is required" });
        }

        const input = await parseJson(req, adminIncidentAcknowledgeRequestSchema);
        const now = new Date();

        await prisma.auditLog.create({
          data: {
            actorUserId: auth.sub,
            action: "incident.acknowledged",
            entityType: "AdminIncident",
            entityId: incidentId,
            metadata: {
              note: input.note ?? null
            }
          }
        });

        const response = adminIncidentAcknowledgeResponseSchema.parse({
          incidentId,
          acknowledged: true,
          acknowledgedAt: now.toISOString(),
          acknowledgedByUserId: auth.sub
        });

        return jsonResponse(200, response);
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}
