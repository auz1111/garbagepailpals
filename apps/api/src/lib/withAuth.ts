import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import type { Role } from "@gpp/shared";
import { verifyAccessToken, type AuthTokenPayload } from "./jwt";
import { jsonResponse } from "./http";

export type AuthenticatedHandler = (
  request: HttpRequest,
  context: InvocationContext,
  auth: AuthTokenPayload
) => Promise<HttpResponseInit>;

type AuthOptions = {
  roles?: Role[];
};

function getBearerToken(request: HttpRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token;
}

export function withAuth(handler: AuthenticatedHandler, options: AuthOptions = {}) {
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const token = getBearerToken(request);
    if (!token) {
      return jsonResponse(401, { message: "Missing or invalid Authorization header" });
    }

    let auth: AuthTokenPayload;
    try {
      auth = await verifyAccessToken(token);
    } catch (error: unknown) {
      context.warn("Token verification failed", error);
      return jsonResponse(401, { message: "Invalid or expired token" });
    }

    if (options.roles && !options.roles.includes(auth.role)) {
      return jsonResponse(403, { message: "Forbidden" });
    }

    // Handler errors propagate to withErrorBoundary — do NOT swallow them here,
    // otherwise business errors get mislabeled as auth failures.
    return handler(request, context, auth);
  };
}
