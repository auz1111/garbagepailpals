import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  authResponseSchema,
  loginSchema,
  refreshSchema,
  registerSchema
} from "@gpp/shared";
import {
  authenticateUser,
  createUser,
  issueSessionTokens,
  rotateRefreshToken
} from "../lib/auth";
import { env } from "../lib/env";
import { handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { authRateLimiter, getClientIp } from "../lib/rateLimiter";
import { recordAuthRateLimit } from "../lib/runtimeMetrics";

function unauthorized(message: string): HttpResponseInit {
  return jsonResponse(401, { message });
}

function conflict(message: string): HttpResponseInit {
  return jsonResponse(409, { message });
}

function tooManyRequests(retryAfterSeconds: number): HttpResponseInit {
  const response = jsonResponse(429, {
    message: "Too many requests. Please try again later.",
    retryAfterSeconds
  });

  return {
    ...response,
    headers: {
      ...(response.headers ?? {}),
      "Retry-After": String(retryAfterSeconds)
    }
  };
}

function enforceRateLimit(request: HttpRequest, scope: "register" | "login" | "refresh"): HttpResponseInit | null {
  const ip = getClientIp(request.headers);
  const maxAttemptsByScope = {
    register: env.AUTH_RATE_LIMIT_REGISTER_MAX_ATTEMPTS,
    login: env.AUTH_RATE_LIMIT_LOGIN_MAX_ATTEMPTS,
    refresh: env.AUTH_RATE_LIMIT_REFRESH_MAX_ATTEMPTS
  };

  const result = authRateLimiter.consume(
    `${scope}:${ip}`,
    maxAttemptsByScope[scope],
    env.AUTH_RATE_LIMIT_WINDOW_MS
  );

  if (!result.allowed) {
    recordAuthRateLimit(scope, false);
    return tooManyRequests(result.retryAfterSeconds);
  }

  recordAuthRateLimit(scope, true);

  return null;
}

export async function registerHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  const rateLimitResponse = enforceRateLimit(request, "register");
  if (rateLimitResponse) {
    context.warn("Rate limit exceeded on register endpoint", {
      ip: getClientIp(request.headers)
    });
    return rateLimitResponse;
  }

  return withErrorBoundary(context, async () => {
    try {
      const input = await parseJson(request, registerSchema);
      const user = await createUser(input);
      const tokens = await issueSessionTokens(user);
      const response = authResponseSchema.parse({
        ...tokens,
        user
      });

      return jsonResponse(201, response);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("already in use")) {
        return conflict(error.message);
      }
      throw error;
    }
  });
}

export async function loginHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  const rateLimitResponse = enforceRateLimit(request, "login");
  if (rateLimitResponse) {
    context.warn("Rate limit exceeded on login endpoint", {
      ip: getClientIp(request.headers)
    });
    return rateLimitResponse;
  }

  return withErrorBoundary(context, async () => {
    try {
      const input = await parseJson(request, loginSchema);
      const user = await authenticateUser(input);
      const tokens = await issueSessionTokens(user);
      const response = authResponseSchema.parse({
        ...tokens,
        user
      });

      return jsonResponse(200, response);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("Invalid credentials")) {
        return unauthorized("Invalid credentials");
      }
      throw error;
    }
  });
}

export async function refreshHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  const rateLimitResponse = enforceRateLimit(request, "refresh");
  if (rateLimitResponse) {
    context.warn("Rate limit exceeded on refresh endpoint", {
      ip: getClientIp(request.headers)
    });
    return rateLimitResponse;
  }

  return withErrorBoundary(context, async () => {
    try {
      const input = await parseJson(request, refreshSchema);
      const refreshed = await rotateRefreshToken(input.refreshToken);
      const response = authResponseSchema.parse(refreshed);

      return jsonResponse(200, response);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("Invalid refresh token")) {
        return unauthorized("Invalid refresh token");
      }
      throw error;
    }
  });
}
