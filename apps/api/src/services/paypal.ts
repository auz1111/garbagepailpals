import { Buffer } from "node:buffer";
import { env } from "../lib/env";
import { HttpError } from "../lib/http";
import { computeUserMonthlyCents } from "./billing";
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
  const product = await paypalPost<{ id?: string }>("/v1/catalogs/products", token, {
    name: "Garbage Pail Pals curbside service",
    type: "SERVICE",
    category: "OTHER_SERVICES"
  });
  if (!product.id) {
    throw new Error("PayPal product creation returned no id");
  }

  const plan = await paypalPost<{ id?: string }>("/v1/billing/plans", token, {
    product_id: product.id,
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

  const subscription = await paypalPost<{
    id?: string;
    links?: Array<{ rel?: string; href?: string }>;
  }>("/v1/billing/subscriptions", token, {
    plan_id: plan.id,
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
    return;
  }

  if (
    event.event_type === "BILLING.SUBSCRIPTION.CANCELLED" ||
    event.event_type === "BILLING.SUBSCRIPTION.SUSPENDED" ||
    event.event_type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED"
  ) {
    await revokeEntitlement(userId, "PAYPAL", subscriptionId, `paypal-event-${event.event_type}`);
  }
}
