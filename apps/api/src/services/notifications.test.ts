import { describe, expect, it } from "vitest";
import { shouldSendNotification } from "./reminders";

describe("shouldSendNotification", () => {
  it("returns true when there is no previous send", () => {
    const now = new Date("2026-08-07T00:00:00.000Z");
    expect(shouldSendNotification(null, 12, now)).toBe(true);
  });

  it("returns false within cooldown window", () => {
    const now = new Date("2026-08-07T12:00:00.000Z");
    const lastSent = new Date("2026-08-07T06:30:00.000Z");
    expect(shouldSendNotification(lastSent, 12, now)).toBe(false);
  });

  it("returns true after cooldown window", () => {
    const now = new Date("2026-08-08T12:00:00.000Z");
    const lastSent = new Date("2026-08-07T00:00:00.000Z");
    expect(shouldSendNotification(lastSent, 24, now)).toBe(true);
  });
});
