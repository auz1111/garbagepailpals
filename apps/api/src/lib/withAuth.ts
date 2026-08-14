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

// Which required roles each actual role satisfies. Higher admin tiers subsume
// the lower ones so existing `roles: ["ADMIN"]` / `["OPERATOR", "ADMIN"]` gates
// keep working without editing every call site. Zone-level scoping (who may act
// in WHICH zone) is enforced inside the handlers, not here.
const ROLE_GRANTS: Record<Role, Role[]> = {
  SUPER_ADMIN: ["SUPER_ADMIN", "PRO_OPERATOR", "ADMIN", "PAILPAL", "OPERATOR", "CUSTOMER"],
  PRO_OPERATOR: ["PRO_OPERATOR", "ADMIN", "OPERATOR"],
  ADMIN: ["ADMIN", "OPERATOR"],
  // A PailPal runs their own routes through the operator endpoints (scoped to
  // themselves), so they satisfy OPERATOR as well as their own PAILPAL gate.
  PAILPAL: ["PAILPAL", "OPERATOR"],
  OPERATOR: ["OPERATOR"],
  CUSTOMER: ["CUSTOMER"]
};

function roleAllowed(actual: Role, required: Role[]): boolean {
  const grants = ROLE_GRANTS[actual] ?? [actual];
  return required.some((r) => grants.includes(r));
}

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

    if (options.roles && !roleAllowed(auth.role, options.roles)) {
      return jsonResponse(403, { message: "Forbidden" });
    }

    // Handler errors propagate to withErrorBoundary — do NOT swallow them here,
    // otherwise business errors get mislabeled as auth failures.
    return handler(request, context, auth);
  };
}
