import { env } from "./env";

type CounterPair = {
  allowed: number;
  blocked: number;
};

type AuthScope = "register" | "login" | "refresh";

type RuntimeCounterState = {
  register: CounterPair;
  login: CounterPair;
  refresh: CounterPair;
};

const processStartedAt = new Date();

const counters: RuntimeCounterState = {
  register: { allowed: 0, blocked: 0 },
  login: { allowed: 0, blocked: 0 },
  refresh: { allowed: 0, blocked: 0 }
};

export function recordAuthRateLimit(scope: AuthScope, allowed: boolean): void {
  if (allowed) {
    counters[scope].allowed += 1;
    return;
  }

  counters[scope].blocked += 1;
}

export function getRuntimeMetricsSnapshot(): {
  runtime: {
    startedAt: string;
    uptimeSeconds: number;
  };
  authRateLimits: {
    windowMs: number;
    register: CounterPair;
    login: CounterPair;
    refresh: CounterPair;
  };
  notifications: {
    provider: "mock" | "resend";
    maxRetries: number;
    retryBaseDelayMs: number;
  };
} {
  return {
    runtime: {
      startedAt: processStartedAt.toISOString(),
      uptimeSeconds: Math.max(0, Math.floor(process.uptime()))
    },
    authRateLimits: {
      windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
      register: { ...counters.register },
      login: { ...counters.login },
      refresh: { ...counters.refresh }
    },
    notifications: {
      provider: env.NOTIFICATION_PROVIDER,
      maxRetries: env.NOTIFICATION_MAX_RETRIES,
      retryBaseDelayMs: env.NOTIFICATION_RETRY_BASE_DELAY_MS
    }
  };
}

export function resetRuntimeMetricsForTest(): void {
  counters.register.allowed = 0;
  counters.register.blocked = 0;
  counters.login.allowed = 0;
  counters.login.blocked = 0;
  counters.refresh.allowed = 0;
  counters.refresh.blocked = 0;
}
