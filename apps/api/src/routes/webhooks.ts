import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { handleOptions, jsonResponse } from "../lib/http";
import { processWebhookIdempotently } from "../services/webhookProcessor";
import { handlePayPalWebhookEvent, verifyPayPalWebhookSignature } from "../services/paypal";
import { handleStripeWebhookEvent, verifyStripeSignature } from "../services/stripe";

export async function stripeWebhookHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  try {
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return jsonResponse(400, { message: "Missing Stripe signature" });
    }

    const rawBody = await request.text();
    const event = verifyStripeSignature(rawBody, signature);

    await processWebhookIdempotently({
      provider: "stripe",
      externalEventId: event.id,
      payload: event,
      handler: async () => {
        await handleStripeWebhookEvent(event as unknown as { id: string; type: string; data: { object: Record<string, unknown> } });
      }
    });

    return jsonResponse(200, { received: true });
  } catch (error: unknown) {
    context.error("Stripe webhook error", error);
    return jsonResponse(200, { received: true });
  }
}

export async function paypalWebhookHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  try {
    const payload = (await request.json()) as { id?: string; event_type?: string; resource?: Record<string, unknown> };
    if (!payload.id || !payload.event_type || !payload.resource) {
      return jsonResponse(400, { message: "Malformed PayPal webhook payload" });
    }

    const verified = await verifyPayPalWebhookSignature({
      headers: request.headers,
      body: payload
    });

    if (!verified) {
      return jsonResponse(400, { message: "Invalid PayPal webhook signature" });
    }

    await processWebhookIdempotently({
      provider: "paypal",
      externalEventId: payload.id,
      payload,
      handler: async () => {
        await handlePayPalWebhookEvent({
          id: payload.id as string,
          event_type: payload.event_type as string,
          resource: payload.resource as Record<string, unknown>
        });
      }
    });

    return jsonResponse(200, { received: true });
  } catch (error: unknown) {
    context.error("PayPal webhook error", error);
    return jsonResponse(200, { received: true });
  }
}
