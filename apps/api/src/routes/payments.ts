import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import {
  paypalCreateSubscriptionRequestSchema,
  paypalCreateSubscriptionResponseSchema,
  stripeCheckoutRequestSchema,
  stripeCheckoutResponseSchema,
  stripePortalRequestSchema,
  stripePortalResponseSchema
} from "@gpp/shared";
import { handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";
import { createPayPalSubscription } from "../services/paypal";
import { createStripeCheckoutSession, createStripePortalSession } from "../services/stripe";

export async function createStripeCheckoutHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(async (req, _ctx, auth) => {
      const input = await parseJson(req, stripeCheckoutRequestSchema);
      const result = await createStripeCheckoutSession({
        userId: auth.sub,
        userEmail: auth.email,
        planCode: input.planCode,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl
      });

      return jsonResponse(200, stripeCheckoutResponseSchema.parse(result));
    })(request, context)
  );
}

export async function createStripePortalHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(async (req, _ctx, auth) => {
      const input = await parseJson(req, stripePortalRequestSchema);
      const result = await createStripePortalSession({
        userId: auth.sub,
        returnUrl: input.returnUrl
      });

      return jsonResponse(200, stripePortalResponseSchema.parse(result));
    })(request, context)
  );
}

export async function createPayPalSubscriptionHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(async (req, _ctx, auth) => {
      const input = await parseJson(req, paypalCreateSubscriptionRequestSchema);
      const result = await createPayPalSubscription({
        userId: auth.sub,
        planCode: input.planCode,
        returnUrl: input.returnUrl,
        cancelUrl: input.cancelUrl
      });

      return jsonResponse(200, paypalCreateSubscriptionResponseSchema.parse(result));
    })(request, context)
  );
}
