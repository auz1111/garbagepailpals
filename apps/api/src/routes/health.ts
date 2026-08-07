import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { handleOptions, jsonResponse, withErrorBoundary } from "../lib/http";

export async function healthHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    jsonResponse(200, {
      status: "ok",
      service: "@gpp/api",
      timestamp: new Date().toISOString()
    })
  );
}
