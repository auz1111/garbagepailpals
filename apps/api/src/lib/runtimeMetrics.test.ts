import { afterEach, describe, expect, it } from "vitest";
import { getRuntimeMetricsSnapshot, recordAuthRateLimit, resetRuntimeMetricsForTest } from "./runtimeMetrics";

afterEach(() => {
  resetRuntimeMetricsForTest();
});

describe("runtime metrics", () => {
  it("tracks allowed and blocked auth rate-limit counters per scope", () => {
    recordAuthRateLimit("login", true);
    recordAuthRateLimit("login", false);
    recordAuthRateLimit("register", false);

    const snapshot = getRuntimeMetricsSnapshot();

    expect(snapshot.authRateLimits.login.allowed).toBe(1);
    expect(snapshot.authRateLimits.login.blocked).toBe(1);
    expect(snapshot.authRateLimits.register.allowed).toBe(0);
    expect(snapshot.authRateLimits.register.blocked).toBe(1);
  });

  it("exposes runtime and notification config data", () => {
    const snapshot = getRuntimeMetricsSnapshot();

    expect(snapshot.runtime.startedAt).toMatch(/T/);
    expect(snapshot.runtime.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(["mock", "resend"]).toContain(snapshot.notifications.provider);
    expect(snapshot.notifications.maxRetries).toBeGreaterThanOrEqual(0);
    expect(snapshot.notifications.retryBaseDelayMs).toBeGreaterThan(0);
  });
});
