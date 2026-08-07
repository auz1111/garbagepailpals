export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type Bucket = {
  timestamps: number[];
};

export class InMemoryRateLimiter {
  private buckets = new Map<string, Bucket>();

  consume(key: string, maxAttempts: number, windowMs: number, now = Date.now()): RateLimitResult {
    const windowStart = now - windowMs;
    const existing = this.buckets.get(key);
    const timestamps = (existing?.timestamps ?? []).filter((ts) => ts > windowStart);

    if (timestamps.length >= maxAttempts) {
      const oldest = timestamps[0] ?? now;
      const retryAfterMs = Math.max(0, oldest + windowMs - now);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000)
      };
    }

    timestamps.push(now);
    this.buckets.set(key, { timestamps });

    return {
      allowed: true,
      remaining: Math.max(0, maxAttempts - timestamps.length),
      retryAfterSeconds: 0
    };
  }

  clear(): void {
    this.buckets.clear();
  }
}

export const authRateLimiter = new InMemoryRateLimiter();

export function getClientIp(requestHeaders: Headers): string {
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = requestHeaders.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
}
