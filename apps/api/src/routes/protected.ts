import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
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
      const response = meResponseSchema.parse({
        user: {
          id: auth.sub,
          email: auth.email,
          name: auth.name,
          role: auth.role
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
