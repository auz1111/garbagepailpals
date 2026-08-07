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
});
