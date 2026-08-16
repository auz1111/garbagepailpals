import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { meResponseSchema, protectedMessageSchema } from "@gpp/shared";
import { handleOptions, jsonResponse, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";

export async function meHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(async (_req, _ctx, auth) => {
      // Read name/email/phone from the DB (not the JWT) so profile edits show
      // up immediately, before a new token is minted on refresh.
      const dbUser = await prisma.user.findUnique({
        where: { id: auth.sub },
        select: {
          name: true,
          email: true,
          phone: true,
          createdAt: true,
          requestedServiceArea: true,
          operatorAccess: true
        }
      });

      const response = meResponseSchema.parse({
        user: {
          id: auth.sub,
          email: dbUser?.email ?? auth.email,
          name: dbUser?.name ?? auth.name,
          role: auth.role,
          phone: dbUser?.phone ?? null,
          createdAt: dbUser?.createdAt?.toISOString(),
          requestedServiceArea: dbUser?.requestedServiceArea ?? null,
          operatorAccess: dbUser?.operatorAccess ?? false
        }
      });

      return jsonResponse(200, response);
    })(request, context)
  );
}

export async function operatorRouteHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (_req, _ctx, auth) => {
        const response = protectedMessageSchema.parse({
          message: "Operator route authorized",
          user: {
            id: auth.sub,
            email: auth.email,
            name: auth.name,
            role: auth.role
          }
        });

        return jsonResponse(200, response);
      },
      { roles: ["OPERATOR", "ADMIN"] }
    )(request, context)
  );
}

export async function adminRouteHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (_req, _ctx, auth) => {
        const response = protectedMessageSchema.parse({
          message: "Admin route authorized",
          user: {
            id: auth.sub,
            email: auth.email,
            name: auth.name,
            role: auth.role
          }
        });

        return jsonResponse(200, response);
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}
