import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { adminRuntimeMetricsSchema } from "@gpp/shared";
import { handleOptions, jsonResponse, withErrorBoundary } from "../lib/http";
import { getRuntimeMetricsSnapshot } from "../lib/runtimeMetrics";
import { withAuth } from "../lib/withAuth";

export async function adminRuntimeMetricsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async () => {
        const response = adminRuntimeMetricsSchema.parse(getRuntimeMetricsSnapshot());
        return jsonResponse(200, response);
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}
