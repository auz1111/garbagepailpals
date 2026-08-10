import Stripe from "stripe";
import { prisma } from "@gpp/db";
import { env } from "../lib/env";
import { HttpError } from "../lib/http";
import {
  activateSubscriptionsForUser,
  computeUserMonthlyCents,
  deactivateSubscriptionsForUser
} from "./billing";
import { grantEntitlement, revokeEntitlement } from "./entitlements";

type StripeEventLike = {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
};

function getStripeClient(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  return new Stripe(env.STRIPE_SECRET_KEY);
}

export function verifyStripeSignature(rawBody: string, signatureHeader: string): Stripe.Event {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe webhook environment variables are not configured");
  }

  const stripe = getStripeClient();
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET);
}

export async function createStripeCheckoutSession(args: {
  userId: string;
  userEmail: string;
  planCode: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ checkoutUrl: string; sessionId: string; amountCents: number }> {
  // Amount is derived server-side from the user's addresses (cans + pickups/week).
  const amountCents = await computeUserMonthlyCents(args.userId);
  if (amountCents <= 0) {
    throw new HttpError(400, "Add a service address before starting a subscription");
  }

  const stripe = getStripeClient();

  const user = await prisma.user.findUnique({ where: { id: args.userId } });
  if (!user) {
    throw new Error("User not found");
  }

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: args.userEmail,
      metadata: { userId: args.userId }
    });

    customerId = customer.id;
    await prisma.user.update({
      where: { id: args.userId },
      data: { stripeCustomerId: customerId }
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          recurring: { interval: "month" },
          product_data: { name: "Garbage Pail Pals curbside service" }
        }
      }
    ],
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    // Stamp userId on the subscription itself so subscription.* webhooks resolve it.
    subscription_data: {
      metadata: { userId: args.userId, amountCents: String(amountCents) }
    },
    metadata: {
      userId: args.userId,
      planCode: args.planCode,
      amountCents: String(amountCents)
    }
  });

  if (!session.url) {
    throw new Error("Stripe checkout URL was not returned");
  }

  return {
    checkoutUrl: session.url,
    sessionId: session.id,
    amountCents
  };
}

export async function createStripePortalSession(args: {
  userId: string;
  returnUrl: string;
}): Promise<{ portalUrl: string }> {
  const stripe = getStripeClient();
  const user = await prisma.user.findUnique({ where: { id: args.userId } });
  if (!user?.stripeCustomerId) {
    throw new Error("Stripe customer is not configured for this user");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: args.returnUrl
  });

  return { portalUrl: session.url };
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export async function handleStripeWebhookEvent(event: StripeEventLike): Promise<void> {
  const object = event.data.object;

  if (event.type === "checkout.session.completed") {
    const userId = asString((object.metadata as Record<string, unknown> | undefined)?.userId);
    const subscriptionId = asString(object.subscription);

    if (!userId || !subscriptionId) {
      return;
    }

    await grantEntitlement(userId, "STRIPE", subscriptionId, null, event);
    await activateSubscriptionsForUser(userId, {
      source: "STRIPE",
      externalSubscriptionId: subscriptionId,
      currentPeriodEnd: null
    });
    return;
  }

  if (event.type === "customer.subscription.updated") {
    const userId = asString((object.metadata as Record<string, unknown> | undefined)?.userId);
    const subscriptionId = asString(object.id);
    const status = asString(object.status);
    const periodEnd = asNumber(object.current_period_end);

    if (!userId || !subscriptionId) {
      return;
    }

    if (status === "active" || status === "trialing") {
      await grantEntitlement(
        userId,
        "STRIPE",
        subscriptionId,
        periodEnd ? new Date(periodEnd * 1000) : null,
        event
      );
      await activateSubscriptionsForUser(userId, {
        source: "STRIPE",
        externalSubscriptionId: subscriptionId,
        currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
        status: status === "trialing" ? "TRIALING" : "ACTIVE"
      });
      return;
    }

    if (status === "past_due" || status === "canceled" || status === "unpaid") {
      await revokeEntitlement(userId, "STRIPE", subscriptionId, `stripe-status-${status}`);
      await deactivateSubscriptionsForUser(userId, status === "past_due" ? "PAST_DUE" : "CANCELED");
    }

    return;
  }

  if (event.type === "customer.subscription.deleted") {
    const userId = asString((object.metadata as Record<string, unknown> | undefined)?.userId);
    const subscriptionId = asString(object.id);
    if (!userId || !subscriptionId) {
      return;
    }

    await revokeEntitlement(userId, "STRIPE", subscriptionId, "stripe-subscription-deleted");
    await deactivateSubscriptionsForUser(userId, "CANCELED");
    return;
  }

  if (event.type === "invoice.payment_failed") {
    const userId = asString((object.metadata as Record<string, unknown> | undefined)?.userId);
    const subscriptionId = asString(object.subscription);
    if (!userId || !subscriptionId) {
      return;
    }

    await revokeEntitlement(userId, "STRIPE", subscriptionId, "stripe-invoice-payment-failed");
    await deactivateSubscriptionsForUser(userId, "PAST_DUE");
  }
}
