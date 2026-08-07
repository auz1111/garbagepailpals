import { describe, expect, it } from "vitest";
import { getClientIp, InMemoryRateLimiter } from "./rateLimiter";

describe("InMemoryRateLimiter", () => {
  it("allows requests under the limit", () => {
    const limiter = new InMemoryRateLimiter();

    const first = limiter.consume("login:1.2.3.4", 2, 60000, 1000);
    const second = limiter.consume("login:1.2.3.4", 2, 60000, 2000);

    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
  });

  it("blocks requests after the limit within window", () => {
    const limiter = new InMemoryRateLimiter();

    limiter.consume("login:1.2.3.4", 2, 60000, 1000);
    limiter.consume("login:1.2.3.4", 2, 60000, 2000);
    const blocked = limiter.consume("login:1.2.3.4", 2, 60000, 3000);

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.remaining).toBe(0);
  });

  it("resets allowance after window elapses", () => {
    const limiter = new InMemoryRateLimiter();

    limiter.consume("login:1.2.3.4", 2, 60000, 1000);
    limiter.consume("login:1.2.3.4", 2, 60000, 2000);
    const allowedAgain = limiter.consume("login:1.2.3.4", 2, 60000, 62001);

    expect(allowedAgain.allowed).toBe(true);
    expect(allowedAgain.remaining).toBe(1);
  });
});

describe("getClientIp", () => {
  it("reads first forwarded address", () => {
    const headers = new Headers({ "x-forwarded-for": "8.8.8.8, 10.0.0.1" });
    expect(getClientIp(headers)).toBe("8.8.8.8");
  });

  it("falls back to x-real-ip", () => {
    const headers = new Headers({ "x-real-ip": "7.7.7.7" });
    expect(getClientIp(headers)).toBe("7.7.7.7");
  });

  it("returns unknown if no ip headers exist", () => {
    const headers = new Headers();
    expect(getClientIp(headers)).toBe("unknown");
  });
});
