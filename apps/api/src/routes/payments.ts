import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import {
  billingSummarySchema,
  paypalCreateSubscriptionRequestSchema,
  paypalCreateSubscriptionResponseSchema,
  stripeCheckoutRequestSchema,
  stripeCheckoutResponseSchema,
  stripePortalRequestSchema,
  stripePortalResponseSchema,
  subscriptionUpdateRequestSchema,
  subscriptionUpdateResponseSchema
} from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";
import { getBillingSummary } from "../services/billing";
import { createPayPalSubscription, revisePayPalSubscription } from "../services/paypal";
import {
  createStripeCheckoutSession,
  createStripePortalSession,
  syncStripeSubscriptionAmount
} from "../services/stripe";

export async function billingSummaryHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(async (_req, _ctx, auth) => {
      const summary = await getBillingSummary(auth.sub);
      return jsonResponse(200, billingSummarySchema.parse(summary));
    })(request, context)
  );
}

export async function updateSubscriptionHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(async (req, _ctx, auth) => {
      const rawBody = await req.text();
      const input = subscriptionUpdateRequestSchema.parse(rawBody ? JSON.parse(rawBody) : {});
      const active = await prisma.subscription.findFirst({
        where: { userId: auth.sub, status: { in: ["ACTIVE", "TRIALING"] } }
      });

      if (!active) {
        throw new HttpError(400, "No active subscription to update. Start one first.");
      }

      if (active.source === "PAYPAL") {
        if (!input.returnUrl || !input.cancelUrl) {
          throw new HttpError(400, "returnUrl and cancelUrl are required to revise a PayPal plan");
        }
        const result = await revisePayPalSubscription(auth.sub, {
          returnUrl: input.returnUrl,
          cancelUrl: input.cancelUrl
        });
        return jsonResponse(200, subscriptionUpdateResponseSchema.parse(result));
      }

      const result = await syncStripeSubscriptionAmount(auth.sub);
      return jsonResponse(
        200,
        subscriptionUpdateResponseSchema.parse({ amountCents: result.amountCents, approvalUrl: null })
      );
    })(request, context)
  );
}

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
