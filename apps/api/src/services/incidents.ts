import type { AdminIncident, AdminIncidentFeed } from "@gpp/shared";

export type JobIncidentInput = {
  id: string;
  failureReason: string | null;
  updatedAt: Date;
};

export type NotificationIncidentInput = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: Date;
};

export type WebhookIncidentInput = {
  id: string;
  provider: string;
  externalEventId: string;
  createdAt: Date;
};

export type IncidentAcknowledgementInput = {
  incidentId: string;
  actorUserId: string | null;
  createdAt: Date;
};

export type IncidentLifecycleEventInput = {
  incidentId: string;
  action: "incident.acknowledged" | "incident.assigned" | "incident.resolved" | "incident.reopened";
  actorUserId: string | null;
  metadata: unknown;
  createdAt: Date;
};

export type IncidentFilterInput = {
  state?: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  source?: "JOB" | "NOTIFICATION" | "WEBHOOK";
  severity?: "WARN" | "CRITICAL";
  ownerUserId?: string;
};

type IncidentState = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

type LifecycleProjection = {
  state: IncidentState;
  stateUpdatedAt: Date;
  ownerUserId: string | null;
  acknowledgedAt: Date | null;
  acknowledgedByUserId: string | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
};

function formatMetadataError(metadata: unknown): string {
  if (typeof metadata === "object" && metadata !== null && "error" in metadata) {
    const value = (metadata as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return "Unknown delivery error";
}

function getOwnerFromMetadata(metadata: unknown): string | null {
  if (typeof metadata === "object" && metadata !== null && "ownerUserId" in metadata) {
    const value = (metadata as { ownerUserId?: unknown }).ownerUserId;
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function projectLifecycle(
  incidentId: string,
  occurredAt: Date,
  eventsByIncidentId: Map<string, IncidentLifecycleEventInput[]>
): LifecycleProjection {
  const projection: LifecycleProjection = {
    state: "OPEN",
    stateUpdatedAt: occurredAt,
    ownerUserId: null,
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    resolvedAt: null,
    resolvedByUserId: null
  };

  const events = eventsByIncidentId.get(incidentId) ?? [];
  for (const event of events) {
    if (event.action === "incident.acknowledged") {
      projection.state = projection.state === "RESOLVED" ? "RESOLVED" : "ACKNOWLEDGED";
      projection.acknowledgedAt = event.createdAt;
      projection.acknowledgedByUserId = event.actorUserId;
      projection.stateUpdatedAt = event.createdAt;
      continue;
    }

    if (event.action === "incident.assigned") {
      const ownerFromMetadata = getOwnerFromMetadata(event.metadata);
      projection.ownerUserId = ownerFromMetadata ?? event.actorUserId;
      projection.stateUpdatedAt = event.createdAt;
      continue;
    }

    if (event.action === "incident.resolved") {
      projection.state = "RESOLVED";
      projection.resolvedAt = event.createdAt;
      projection.resolvedByUserId = event.actorUserId;
      projection.stateUpdatedAt = event.createdAt;
      continue;
    }

    if (event.action === "incident.reopened") {
      projection.state = "OPEN";
      projection.resolvedAt = null;
      projection.resolvedByUserId = null;
      projection.stateUpdatedAt = event.createdAt;
    }
  }

  return projection;
}

function getSlaThresholdMinutes(severity: "WARN" | "CRITICAL"): number {
  return severity === "CRITICAL" ? 5 : 15;
}

function mapIncidentBase(args: {
  id: string;
  source: "JOB" | "NOTIFICATION" | "WEBHOOK";
  severity: "WARN" | "CRITICAL";
  title: string;
  detail: string;
  occurredAt: Date;
  entityType: string;
  entityId: string;
  now: Date;
  eventsByIncidentId: Map<string, IncidentLifecycleEventInput[]>;
}): AdminIncident {
  const lifecycle = projectLifecycle(args.id, args.occurredAt, args.eventsByIncidentId);
  const openMinutes = Math.max(0, Math.floor((args.now.getTime() - args.occurredAt.getTime()) / (60 * 1000)));
  const breachedSla = lifecycle.state !== "RESOLVED" && openMinutes >= getSlaThresholdMinutes(args.severity);

  return {
    id: args.id,
    source: args.source,
    severity: args.severity,
    state: lifecycle.state,
    title: args.title,
    detail: args.detail,
    occurredAt: args.occurredAt.toISOString(),
    stateUpdatedAt: lifecycle.stateUpdatedAt.toISOString(),
    entityType: args.entityType,
    entityId: args.entityId,
    ownerUserId: lifecycle.ownerUserId,
    openMinutes,
    breachedSla,
    acknowledgedAt: lifecycle.acknowledgedAt?.toISOString() ?? null,
    acknowledgedByUserId: lifecycle.acknowledgedByUserId ?? null,
    resolvedAt: lifecycle.resolvedAt?.toISOString() ?? null,
    resolvedByUserId: lifecycle.resolvedByUserId ?? null
  };
}

function matchesFilter(incident: AdminIncident, filter?: IncidentFilterInput): boolean {
  if (!filter) {
    return true;
  }

  if (filter.state && incident.state !== filter.state) {
    return false;
  }

  if (filter.source && incident.source !== filter.source) {
    return false;
  }

  if (filter.severity && incident.severity !== filter.severity) {
    return false;
  }

  if (filter.ownerUserId && incident.ownerUserId !== filter.ownerUserId) {
    if (!(filter.ownerUserId === "__unassigned" && incident.ownerUserId === null)) {
      return false;
    }
  }

  return true;
}

export function buildAdminIncidentFeed(args: {
  failedJobs: JobIncidentInput[];
  failedNotifications: NotificationIncidentInput[];
  staleWebhooks: WebhookIncidentInput[];
  acknowledgements?: IncidentAcknowledgementInput[];
  lifecycleEvents?: IncidentLifecycleEventInput[];
  filter?: IncidentFilterInput;
  now?: Date;
  maxItems?: number;
}): AdminIncidentFeed {
  const lifecycleEvents: IncidentLifecycleEventInput[] = [
    ...(args.lifecycleEvents ?? []),
    ...(args.acknowledgements ?? []).map((item) => ({
      incidentId: item.incidentId,
      action: "incident.acknowledged" as const,
      actorUserId: item.actorUserId,
      metadata: {},
      createdAt: item.createdAt
    }))
  ];

  const eventsByIncidentId = new Map<string, IncidentLifecycleEventInput[]>();
  for (const event of lifecycleEvents) {
    const list = eventsByIncidentId.get(event.incidentId) ?? [];
    list.push(event);
    eventsByIncidentId.set(event.incidentId, list);
  }

  for (const [key, list] of eventsByIncidentId.entries()) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    eventsByIncidentId.set(key, list);
  }

  const now = args.now ?? new Date();
  const incidents: AdminIncident[] = [];

  for (const job of args.failedJobs) {
    const incidentId = `job:${job.id}`;
    incidents.push(
      mapIncidentBase({
        id: incidentId,
        source: "JOB",
        severity: "CRITICAL",
        title: "Service job failed",
        detail: job.failureReason?.trim() || "Job marked as failed without a specific reason",
        occurredAt: job.updatedAt,
        entityType: "ServiceJob",
        entityId: job.id,
        now,
        eventsByIncidentId
      })
    );
  }

  for (const item of args.failedNotifications) {
    const incidentId = `notification:${item.id}`;
    const isOverdue = item.action.includes("overdue");
    incidents.push(
      mapIncidentBase({
        id: incidentId,
        source: "NOTIFICATION",
        severity: "WARN",
        title: isOverdue ? "Overdue alert delivery failed" : "Pickup reminder delivery failed",
        detail: formatMetadataError(item.metadata),
        occurredAt: item.createdAt,
        entityType: item.entityType,
        entityId: item.entityId,
        now,
        eventsByIncidentId
      })
    );
  }

  for (const webhook of args.staleWebhooks) {
    const incidentId = `webhook:${webhook.id}`;
    incidents.push(
      mapIncidentBase({
        id: incidentId,
        source: "WEBHOOK",
        severity: "WARN",
        title: `Unprocessed ${webhook.provider} webhook event`,
        detail: `Event ${webhook.externalEventId} has not been marked processed.`,
        occurredAt: webhook.createdAt,
        entityType: "WebhookEvent",
        entityId: webhook.id,
        now,
        eventsByIncidentId
      })
    );
  }

  const maxItems = args.maxItems ?? 60;
  const sorted = incidents
    .filter((incident) => matchesFilter(incident, args.filter))
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, maxItems);

  return {
    generatedAt: now.toISOString(),
    incidents: sorted
  };
}
