import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { z } from "zod";
import { prisma } from "@gpp/db";
import { serviceAreaCheckResponseSchema } from "@gpp/shared";
import { handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../../lib/http";
import { withAuth } from "../../lib/withAuth";

const serviceAreaRequestSchema = z.object({
  postalCode: z.string().trim().min(3).max(12)
});

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

// Records the postal code a signed-in user wants service in, so we can notify
// them when we expand there. Stored on the user (User.requestedServiceArea).
export async function requestServiceAreaHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(async (req, _ctx, auth) => {
      const { postalCode } = await parseJson(req, serviceAreaRequestSchema);

      await prisma.user.update({
        where: { id: auth.sub },
        data: { requestedServiceArea: postalCode }
      });

      return jsonResponse(200, { postalCode, recorded: true });
    })(request, context)
  );
}
