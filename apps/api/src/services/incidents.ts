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

function formatMetadataError(metadata: unknown): string {
  if (typeof metadata === "object" && metadata !== null && "error" in metadata) {
    const value = (metadata as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return "Unknown delivery error";
}

export function buildAdminIncidentFeed(args: {
  failedJobs: JobIncidentInput[];
  failedNotifications: NotificationIncidentInput[];
  staleWebhooks: WebhookIncidentInput[];
  now?: Date;
  maxItems?: number;
}): AdminIncidentFeed {
  const incidents: AdminIncident[] = [];

  for (const job of args.failedJobs) {
    incidents.push({
      id: `job:${job.id}`,
      source: "JOB",
      severity: "CRITICAL",
      title: "Service job failed",
      detail: job.failureReason?.trim() || "Job marked as failed without a specific reason",
      occurredAt: job.updatedAt.toISOString(),
      entityType: "ServiceJob",
      entityId: job.id
    });
  }

  for (const item of args.failedNotifications) {
    const isOverdue = item.action.includes("overdue");
    incidents.push({
      id: `notification:${item.id}`,
      source: "NOTIFICATION",
      severity: "WARN",
      title: isOverdue ? "Overdue alert delivery failed" : "Pickup reminder delivery failed",
      detail: formatMetadataError(item.metadata),
      occurredAt: item.createdAt.toISOString(),
      entityType: item.entityType,
      entityId: item.entityId
    });
  }

  for (const webhook of args.staleWebhooks) {
    incidents.push({
      id: `webhook:${webhook.id}`,
      source: "WEBHOOK",
      severity: "WARN",
      title: `Unprocessed ${webhook.provider} webhook event`,
      detail: `Event ${webhook.externalEventId} has not been marked processed.`,
      occurredAt: webhook.createdAt.toISOString(),
      entityType: "WebhookEvent",
      entityId: webhook.id
    });
  }

  const maxItems = args.maxItems ?? 60;
  const sorted = incidents
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, maxItems);

  return {
    generatedAt: (args.now ?? new Date()).toISOString(),
    incidents: sorted
  };
}
