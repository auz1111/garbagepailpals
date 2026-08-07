import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import type { AuthTokenPayload } from "./jwt";
import { jsonResponse } from "./http";
import { getActiveEntitlement } from "../services/entitlements";

export type EntitledHandler = (
  request: HttpRequest,
  context: InvocationContext,
  auth: AuthTokenPayload
) => Promise<HttpResponseInit>;

export function withEntitlement(handler: EntitledHandler) {
  return async (request: HttpRequest, context: InvocationContext, auth: AuthTokenPayload): Promise<HttpResponseInit> => {
    const entitlement = await getActiveEntitlement(auth.sub);
    if (!entitlement) {
      return jsonResponse(402, { message: "Active entitlement required" });
    }

    return handler(request, context, auth);
  };
}
