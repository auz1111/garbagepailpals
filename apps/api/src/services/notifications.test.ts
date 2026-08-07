import { describe, expect, it } from "vitest";
import { getRetryDelayMs, shouldRetryResendStatus } from "./notifications";
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

describe("notification retry helpers", () => {
  it("retries on throttling and server errors", () => {
    expect(shouldRetryResendStatus(429)).toBe(true);
    expect(shouldRetryResendStatus(500)).toBe(true);
    expect(shouldRetryResendStatus(503)).toBe(true);
  });

  it("does not retry on client validation errors", () => {
    expect(shouldRetryResendStatus(400)).toBe(false);
    expect(shouldRetryResendStatus(401)).toBe(false);
    expect(shouldRetryResendStatus(422)).toBe(false);
  });

  it("calculates exponential backoff delay", () => {
    expect(getRetryDelayMs(1, 300)).toBe(300);
    expect(getRetryDelayMs(2, 300)).toBe(600);
    expect(getRetryDelayMs(3, 300)).toBe(1200);
  });
});
