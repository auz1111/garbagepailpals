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
import { handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";

function unauthorized(message: string): HttpResponseInit {
  return jsonResponse(401, { message });
}

function conflict(message: string): HttpResponseInit {
  return jsonResponse(409, { message });
}

export async function registerHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
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
