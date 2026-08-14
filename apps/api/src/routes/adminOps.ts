import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import {
  adminIncidentAssignRequestSchema,
  adminIncidentAssignResponseSchema,
  adminIncidentAcknowledgeRequestSchema,
  adminIncidentAcknowledgeResponseSchema,
  adminIncidentReopenRequestSchema,
  adminIncidentReopenResponseSchema,
  adminIncidentResolveRequestSchema,
  adminIncidentResolveResponseSchema,
  adminIncidentFeedSchema,
  adminRuntimeMetricsSchema
} from "@gpp/shared";
import { handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { getRuntimeMetricsSnapshot } from "../lib/runtimeMetrics";
import { buildAdminIncidentFeed } from "../services/incidents";
import { withAuth } from "../lib/withAuth";

type IncidentFilter = {
  state?: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  source?: "JOB" | "NOTIFICATION" | "WEBHOOK";
  severity?: "WARN" | "CRITICAL";
  ownerUserId?: string;
};

function parseIncidentFilter(request: HttpRequest): IncidentFilter {
  const params = new URL(request.url).searchParams;

  const state = params.get("state");
  const source = params.get("source");
  const severity = params.get("severity");
  const ownerUserId = params.get("ownerUserId");

  const filter: IncidentFilter = {};

  if (state && ["OPEN", "ACKNOWLEDGED", "RESOLVED"].includes(state)) {
    filter.state = state as IncidentFilter["state"];
  }

  if (source && ["JOB", "NOTIFICATION", "WEBHOOK"].includes(source)) {
    filter.source = source as IncidentFilter["source"];
  }

  if (severity && ["WARN", "CRITICAL"].includes(severity)) {
    filter.severity = severity as IncidentFilter["severity"];
  }

  if (ownerUserId) {
    filter.ownerUserId = ownerUserId;
  }

  return filter;
}

async function writeIncidentLifecycleLog(args: {
  actorUserId: string;
  incidentId: string;
  action: "incident.acknowledged" | "incident.assigned" | "incident.resolved" | "incident.reopened";
  metadata: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: args.actorUserId,
      action: args.action,
      entityType: "AdminIncident",
      entityId: args.incidentId,
      metadata: args.metadata as any
    }
  });
}

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
        const filter = parseIncidentFilter(request);

        const [failedJobs, failedNotifications, staleWebhooks, lifecycleEvents] = await Promise.all([
          // Failed service is now recorded on the route stop, not a job row.
          (async () =>
            (
              await prisma.routeStop.findMany({
                where: { status: "FAILED", route: { serviceDate: { gte: weekAgo } } },
                orderBy: { route: { serviceDate: "desc" } },
                take: 40,
                select: { id: true, failureReason: true, route: { select: { serviceDate: true } } }
              })
            ).map((s) => ({ id: s.id, failureReason: s.failureReason, updatedAt: s.route.serviceDate })))(),
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
              action: {
                in: ["incident.acknowledged", "incident.assigned", "incident.resolved", "incident.reopened"]
              },
              entityType: "AdminIncident",
              createdAt: { gte: monthAgo }
            },
            orderBy: { createdAt: "desc" },
            take: 300,
            select: {
              action: true,
              entityId: true,
              actorUserId: true,
              metadata: true,
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
            filter,
            lifecycleEvents: lifecycleEvents.map((item: any) => ({
              incidentId: item.entityId,
              action: item.action as
                | "incident.acknowledged"
                | "incident.assigned"
                | "incident.resolved"
                | "incident.reopened",
              actorUserId: item.actorUserId,
              metadata: item.metadata,
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

        await writeIncidentLifecycleLog({
          actorUserId: auth.sub,
          incidentId,
          action: "incident.acknowledged",
          metadata: {
            note: input.note ?? null
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

export async function adminAssignIncidentHandler(
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

        const input = await parseJson(req, adminIncidentAssignRequestSchema);
        const ownerUserId = input.ownerUserId ?? auth.sub;
        const now = new Date();

        await writeIncidentLifecycleLog({
          actorUserId: auth.sub,
          incidentId,
          action: "incident.assigned",
          metadata: {
            ownerUserId,
            note: input.note ?? null
          }
        });

        const response = adminIncidentAssignResponseSchema.parse({
          incidentId,
          ownerUserId,
          assignedAt: now.toISOString(),
          assignedByUserId: auth.sub
        });

        return jsonResponse(200, response);
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

export async function adminResolveIncidentHandler(
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

        const input = await parseJson(req, adminIncidentResolveRequestSchema);
        const now = new Date();

        await writeIncidentLifecycleLog({
          actorUserId: auth.sub,
          incidentId,
          action: "incident.resolved",
          metadata: {
            note: input.note ?? null
          }
        });

        const response = adminIncidentResolveResponseSchema.parse({
          incidentId,
          resolved: true,
          resolvedAt: now.toISOString(),
          resolvedByUserId: auth.sub
        });

        return jsonResponse(200, response);
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

export async function adminReopenIncidentHandler(
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

        const input = await parseJson(req, adminIncidentReopenRequestSchema);
        const now = new Date();

        await writeIncidentLifecycleLog({
          actorUserId: auth.sub,
          incidentId,
          action: "incident.reopened",
          metadata: {
            note: input.note ?? null
          }
        });

        const response = adminIncidentReopenResponseSchema.parse({
          incidentId,
          reopened: true,
          reopenedAt: now.toISOString(),
          reopenedByUserId: auth.sub
        });

        return jsonResponse(200, response);
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}
