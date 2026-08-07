import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { serviceAreaCheckResponseSchema } from "@gpp/shared";
import { handleOptions, jsonResponse, withErrorBoundary } from "../../lib/http";

export async function serviceAreaCheckHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () => {
    const postalCode = request.query.get("postalCode")?.trim();
    if (!postalCode) {
      return jsonResponse(400, { message: "postalCode query parameter is required" });
    }

    const serviceArea = await prisma.serviceArea.findUnique({
      where: { postalCode }
    });

    const response = serviceAreaCheckResponseSchema.parse({
      postalCode,
      eligible: Boolean(serviceArea?.isActive)
    });

    return jsonResponse(200, response);
  });
}
