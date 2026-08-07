import { Buffer } from "node:buffer";
import { prisma } from "@gpp/db";
import { env } from "../lib/env";
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

export async function createPayPalSubscription(args: {
  userId: string;
  planCode: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<{ approvalUrl: string; subscriptionId: string }> {
  const plan = await prisma.plan.findUnique({ where: { code: args.planCode } });
  if (!plan?.paypalPlanId) {
    throw new Error("Plan is not configured for PayPal");
  }

  const token = await getPayPalAccessToken();
  const response = await fetch(`${getPayPalBaseUrl()}/v1/billing/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      plan_id: plan.paypalPlanId,
      custom_id: args.userId,
      application_context: {
        brand_name: "Garbage Pail Pals",
        user_action: "SUBSCRIBE_NOW",
        return_url: args.returnUrl,
        cancel_url: args.cancelUrl
      }
    })
  });

  if (!response.ok) {
    throw new Error("Failed to create PayPal subscription");
  }

  const payload = (await response.json()) as {
    id?: string;
    links?: Array<{ rel?: string; href?: string }>;
  };

  const approvalUrl = payload.links?.find((link) => link.rel === "approve")?.href;
  if (!payload.id || !approvalUrl) {
    throw new Error("PayPal subscription response missing approval URL or id");
  }

  return {
    approvalUrl,
    subscriptionId: payload.id
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
