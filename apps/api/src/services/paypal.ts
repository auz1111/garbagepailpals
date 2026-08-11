import { Buffer } from "node:buffer";
import { prisma } from "@gpp/db";
import { env } from "../lib/env";
import { HttpError } from "../lib/http";
import {
  activateSubscriptionsForUser,
  computeUserMonthlyCents,
  deactivateSubscriptionsForUser
} from "./billing";
import { grantEntitlement, revokeEntitlement } from "./entitlements";

type PayPalWebhookEvent = {
  id: string;
  event_type: string;
  resource: Record<string, unknown>;
};

function getPayPalBaseUrl(): string {
  return env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

// PayPal has no merchant-hosted billing portal like Stripe — customers manage
// (or cancel) recurring payments from their own PayPal account. Send them to the
// autopay page for the matching environment.
export function getPayPalManagementUrl(): string {
  return env.PAYPAL_ENV === "live"
    ? "https://www.paypal.com/myaccount/autopay/"
    : "https://www.sandbox.paypal.com/myaccount/autopay/";
}

async function getPayPalAccessToken(): Promise<string> {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal client credentials are not configured");
  }

  const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  if (!response.ok) {
    throw new Error("Unable to acquire PayPal access token");
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("PayPal access token missing");
  }

  return payload.access_token;
}

async function paypalPost<T>(path: string, token: string, body: unknown): Promise<T> {
  const response = await fetch(`${getPayPalBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`PayPal ${path} failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  return (await response.json()) as T;
}

export async function createPayPalSubscription(args: {
  userId: string;
  planCode: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<{ approvalUrl: string; subscriptionId: string; amountCents: number }> {
  // Amount is derived server-side from the user's addresses (cans + pickups/week).
  const amountCents = await computeUserMonthlyCents(args.userId);
  if (amountCents <= 0) {
    throw new HttpError(400, "Add a service address before starting a subscription");
  }
  const amountValue = (amountCents / 100).toFixed(2);

  const token = await getPayPalAccessToken();

  // PayPal subscriptions need a product + plan; create them dynamically so the
  // monthly price matches the customer's configured service.
  const planId = await createPayPalPlan(token, amountValue);

  const subscription = await paypalPost<{
    id?: string;
    links?: Array<{ rel?: string; href?: string }>;
  }>("/v1/billing/subscriptions", token, {
    plan_id: planId,
    custom_id: args.userId,
    application_context: {
      brand_name: "Garbage Pail Pals",
      user_action: "SUBSCRIBE_NOW",
      return_url: args.returnUrl,
      cancel_url: args.cancelUrl
    }
  });

  const approvalUrl = subscription.links?.find((link) => link.rel === "approve")?.href;
  if (!subscription.id || !approvalUrl) {
    throw new Error("PayPal subscription response missing approval URL or id");
  }

  return {
    approvalUrl,
    subscriptionId: subscription.id,
    amountCents
  };
}

async function paypalGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${getPayPalBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`PayPal GET ${path} failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

// Build a plan for a given monthly amount. Reuses an existing product when
// provided (required for revise: the new plan must share the old plan's product).
async function createPayPalPlan(
  token: string,
  amountValue: string,
  existingProductId?: string
): Promise<string> {
  let productId = existingProductId;
  if (!productId) {
    const product = await paypalPost<{ id?: string }>("/v1/catalogs/products", token, {
      name: "Garbage Pail Pals curbside service",
      type: "SERVICE"
    });
    if (!product.id) {
      throw new Error("PayPal product creation returned no id");
    }
    productId = product.id;
  }

  const plan = await paypalPost<{ id?: string }>("/v1/billing/plans", token, {
    product_id: productId,
    name: `GPP Monthly ${amountValue} USD`,
    billing_cycles: [
      {
        frequency: { interval_unit: "MONTH", interval_count: 1 },
        tenure_type: "REGULAR",
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: { fixed_price: { value: amountValue, currency_code: "USD" } }
      }
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
      setup_fee: { value: "0", currency_code: "USD" },
      setup_fee_failure_action: "CONTINUE",
      payment_failure_threshold: 1
    }
  });
  if (!plan.id) {
    throw new Error("PayPal plan creation returned no id");
  }
  return plan.id;
}

// Amend a PayPal subscription to the user's current total by revising it onto a
// new plan. Price changes require buyer re-approval, so this returns an approval
// URL the customer must visit; the BILLING.SUBSCRIPTION.UPDATED webhook then syncs.
export async function revisePayPalSubscription(
  userId: string,
  args: { returnUrl: string; cancelUrl: string }
): Promise<{ amountCents: number; approvalUrl: string | null }> {
  const active = await prisma.subscription.findFirst({
    where: {
      userId,
      source: "PAYPAL",
      status: { in: ["ACTIVE", "TRIALING"] },
      externalSubscriptionId: { not: null }
    }
  });
  if (!active?.externalSubscriptionId) {
    throw new HttpError(400, "No active PayPal subscription to update");
  }

  const amountCents = await computeUserMonthlyCents(userId);
  if (amountCents <= 0) {
    throw new HttpError(400, "Add a service address before updating your subscription");
  }
  const amountValue = (amountCents / 100).toFixed(2);

  const token = await getPayPalAccessToken();

  // PayPal requires the revised plan to belong to the same product as the
  // current one, so look up the existing subscription's plan → product.
  const currentSub = await paypalGet<{ plan_id?: string }>(
    `/v1/billing/subscriptions/${active.externalSubscriptionId}`,
    token
  );
  let productId: string | undefined;
  if (currentSub.plan_id) {
    const currentPlan = await paypalGet<{ product_id?: string }>(
      `/v1/billing/plans/${currentSub.plan_id}`,
      token
    );
    productId = currentPlan.product_id;
  }

  const planId = await createPayPalPlan(token, amountValue, productId);

  const revision = await paypalPost<{ links?: Array<{ rel?: string; href?: string }> }>(
    `/v1/billing/subscriptions/${active.externalSubscriptionId}/revise`,
    token,
    {
      plan_id: planId,
      application_context: {
        brand_name: "Garbage Pail Pals",
        user_action: "SUBSCRIBE_NOW",
        return_url: args.returnUrl,
        cancel_url: args.cancelUrl
      }
    }
  );

  const approvalUrl = revision.links?.find((link) => link.rel === "approve")?.href ?? null;

  // If PayPal applied the change without requiring approval, reflect it now.
  if (!approvalUrl) {
    await activateSubscriptionsForUser(userId, {
      source: "PAYPAL",
      externalSubscriptionId: active.externalSubscriptionId,
      currentPeriodEnd: null
    });
  }

  return { amountCents, approvalUrl };
}

// Verify a subscription directly with PayPal on return from approval, so we can
// activate immediately instead of waiting for the (often delayed) webhook.
export async function confirmPayPalSubscription(
  userId: string,
  subscriptionId: string
): Promise<{ status: string; active: boolean }> {
  const token = await getPayPalAccessToken();
  const response = await fetch(`${getPayPalBaseUrl()}/v1/billing/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    throw new HttpError(400, `Could not verify PayPal subscription (${response.status})`);
  }

  const sub = (await response.json()) as {
    status?: string;
    custom_id?: string;
    billing_info?: { next_billing_time?: string };
  };

  // Guard: the subscription must belong to this user.
  if (sub.custom_id && sub.custom_id !== userId) {
    throw new HttpError(403, "Subscription does not belong to this account");
  }

  const status = sub.status ?? "UNKNOWN";
  const active = status === "ACTIVE" || status === "APPROVED";

  if (active) {
    await grantEntitlement(userId, "PAYPAL", subscriptionId, null, {
      id: `paypal-confirm-${subscriptionId}`,
      event_type: "CONFIRM_ON_RETURN",
      resource: sub
    });
    await activateSubscriptionsForUser(userId, {
      source: "PAYPAL",
      externalSubscriptionId: subscriptionId,
      currentPeriodEnd: sub.billing_info?.next_billing_time
        ? new Date(sub.billing_info.next_billing_time)
        : null
    });
  }

  return { status, active };
}

export async function verifyPayPalWebhookSignature(args: {
  headers: Headers;
  body: unknown;
}): Promise<boolean> {
  if (!env.PAYPAL_WEBHOOK_ID) {
    throw new Error("PAYPAL_WEBHOOK_ID is not configured");
  }

  const token = await getPayPalAccessToken();

  const transmissionId = args.headers.get("paypal-transmission-id");
  const transmissionTime = args.headers.get("paypal-transmission-time");
  const certUrl = args.headers.get("paypal-cert-url");
  const authAlgo = args.headers.get("paypal-auth-algo");
  const transmissionSig = args.headers.get("paypal-transmission-sig");

  if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
    return false;
  }

  const response = await fetch(`${getPayPalBaseUrl()}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: args.body
    })
  });

  if (!response.ok) {
    return false;
  }

  const payload = (await response.json()) as { verification_status?: string };
  return payload.verification_status === "SUCCESS";
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export async function handlePayPalWebhookEvent(event: PayPalWebhookEvent): Promise<void> {
  const resource = event.resource;
  const subscriptionId =
    asString(resource.id) ??
    asString(resource.billing_agreement_id) ??
    asString(resource.parent_payment);
  const userId = asString(resource.custom_id);

  if (!subscriptionId || !userId) {
    return;
  }

  if (
    event.event_type === "BILLING.SUBSCRIPTION.ACTIVATED" ||
    event.event_type === "PAYMENT.SALE.COMPLETED"
  ) {
    await grantEntitlement(userId, "PAYPAL", subscriptionId, null, event);
    await activateSubscriptionsForUser(userId, {
      source: "PAYPAL",
      externalSubscriptionId: subscriptionId,
      currentPeriodEnd: null
    });
    return;
  }

  if (
    event.event_type === "BILLING.SUBSCRIPTION.CANCELLED" ||
    event.event_type === "BILLING.SUBSCRIPTION.SUSPENDED" ||
    event.event_type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED"
  ) {
    await revokeEntitlement(userId, "PAYPAL", subscriptionId, `paypal-event-${event.event_type}`);
    await deactivateSubscriptionsForUser(
      userId,
      event.event_type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED" ? "PAST_DUE" : "CANCELED"
    );
  }
}
