import { describe, expect, it } from "vitest";
import { buildAdminIncidentFeed } from "./incidents";

describe("buildAdminIncidentFeed", () => {
  it("maps job, notification, and webhook incidents", () => {
    const feed = buildAdminIncidentFeed({
      now: new Date("2026-08-07T00:00:00.000Z"),
      failedJobs: [
        {
          id: "job_1",
          failureReason: "Truck unavailable",
          updatedAt: new Date("2026-08-06T23:00:00.000Z")
        }
      ],
      failedNotifications: [
        {
          id: "log_1",
          action: "notification.reminder.failed",
          entityType: "ServiceJob",
          entityId: "job_2",
          metadata: { error: "SMTP timeout" },
          createdAt: new Date("2026-08-06T22:00:00.000Z")
        }
      ],
      staleWebhooks: [
        {
          id: "we_1",
          provider: "stripe",
          externalEventId: "evt_123",
          createdAt: new Date("2026-08-06T21:00:00.000Z")
        }
      ]
    });

    expect(feed.incidents.length).toBe(3);
    expect(feed.incidents[0]?.source).toBe("JOB");
    expect(feed.incidents[1]?.source).toBe("NOTIFICATION");
    expect(feed.incidents[2]?.source).toBe("WEBHOOK");
  });

  it("orders incidents by occurredAt descending and applies maxItems", () => {
    const feed = buildAdminIncidentFeed({
      maxItems: 2,
      failedJobs: [
        {
          id: "job_old",
          failureReason: "Old",
          updatedAt: new Date("2026-08-05T00:00:00.000Z")
        },
        {
          id: "job_new",
          failureReason: "New",
          updatedAt: new Date("2026-08-07T00:00:00.000Z")
        }
      ],
      failedNotifications: [],
      staleWebhooks: []
    });

    expect(feed.incidents.length).toBe(2);
    expect(feed.incidents[0]?.entityId).toBe("job_new");
    expect(feed.incidents[1]?.entityId).toBe("job_old");
  });

  it("attaches acknowledgement metadata to matching incident ids", () => {
    const feed = buildAdminIncidentFeed({
      failedJobs: [
        {
          id: "job_1",
          failureReason: "Blocked alley",
          updatedAt: new Date("2026-08-07T00:00:00.000Z")
        }
      ],
      failedNotifications: [],
      staleWebhooks: [],
      acknowledgements: [
        {
          incidentId: "job:job_1",
          actorUserId: "admin_1",
          createdAt: new Date("2026-08-07T01:00:00.000Z")
        }
      ]
    });

    expect(feed.incidents[0]?.acknowledgedByUserId).toBe("admin_1");
    expect(feed.incidents[0]?.acknowledgedAt).toBe("2026-08-07T01:00:00.000Z");
  });

  it("projects lifecycle state transitions and ownership", () => {
    const feed = buildAdminIncidentFeed({
      now: new Date("2026-08-07T02:00:00.000Z"),
      failedJobs: [
        {
          id: "job_1",
          failureReason: "Blocked",
          updatedAt: new Date("2026-08-07T00:00:00.000Z")
        }
      ],
      failedNotifications: [],
      staleWebhooks: [],
      lifecycleEvents: [
        {
          incidentId: "job:job_1",
          action: "incident.assigned",
          actorUserId: "admin_1",
          metadata: { ownerUserId: "admin_2" },
          createdAt: new Date("2026-08-07T00:30:00.000Z")
        },
        {
          incidentId: "job:job_1",
          action: "incident.acknowledged",
          actorUserId: "admin_2",
          metadata: {},
          createdAt: new Date("2026-08-07T01:00:00.000Z")
        },
        {
          incidentId: "job:job_1",
          action: "incident.resolved",
          actorUserId: "admin_3",
          metadata: {},
          createdAt: new Date("2026-08-07T01:30:00.000Z")
        }
      ]
    });

    expect(feed.incidents[0]?.state).toBe("RESOLVED");
    expect(feed.incidents[0]?.ownerUserId).toBe("admin_2");
    expect(feed.incidents[0]?.resolvedByUserId).toBe("admin_3");
    expect(feed.incidents[0]?.breachedSla).toBe(false);
  });

  it("computes SLA breach for open incidents and supports state filtering", () => {
    const feed = buildAdminIncidentFeed({
      now: new Date("2026-08-07T00:20:00.000Z"),
      failedJobs: [
        {
          id: "job_open",
          failureReason: "Open issue",
          updatedAt: new Date("2026-08-07T00:00:00.000Z")
        }
      ],
      failedNotifications: [],
      staleWebhooks: [],
      filter: { state: "OPEN" }
    });

    expect(feed.incidents.length).toBe(1);
    expect(feed.incidents[0]?.breachedSla).toBe(true);
    expect(feed.incidents[0]?.openMinutes).toBe(20);
  });
});
