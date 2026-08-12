import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { z } from "zod";
import { prisma } from "@gpp/db";
import { serviceAreaCheckResponseSchema } from "@gpp/shared";
import { handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../../lib/http";
import { isPostalServiceable } from "../../lib/serviceArea";
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

    const response = serviceAreaCheckResponseSchema.parse({
      postalCode,
      eligible: await isPostalServiceable(postalCode)
    });

    return jsonResponse(200, response);
  });
}

// Checks whether a signed-in user's postal code is serviced and records the
// outcome on the user: if serviced, clears any outstanding request; if not,
// stores the postal code (User.requestedServiceArea) so we can notify them
// when we expand there.
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

      const eligible = await isPostalServiceable(postalCode);

      await prisma.user.update({
        where: { id: auth.sub },
        data: { requestedServiceArea: eligible ? null : postalCode }
      });

      return jsonResponse(200, { postalCode, eligible });
    })(request, context)
  );
}
