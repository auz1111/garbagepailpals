import { prisma } from "@gpp/db";
import { env } from "../lib/env";

export type ActiveEntitlement = {
  userId: string;
  source: "STRIPE" | "PAYPAL" | "REVENUECAT" | "DEV" | "MANAGED";
  externalSubscriptionId: string;
  expiresAt: Date | null;
};

type RealEntitlementSource = "STRIPE" | "PAYPAL" | "REVENUECAT";

function expiresAtWeight(value: Date | null): number {
  return value ? value.getTime() : Number.MAX_SAFE_INTEGER;
}

export async function grantEntitlement(
  userId: string,
  source: RealEntitlementSource,
  externalSubscriptionId: string,
  expiresAt: Date | null,
  rawPayload: unknown
): Promise<void> {
  await prisma.entitlement.upsert({
    where: {
      source_externalSubscriptionId: {
        source,
        externalSubscriptionId
      }
    },
    create: {
      userId,
      source,
      externalSubscriptionId,
      status: "ACTIVE",
      expiresAt,
      rawPayload: rawPayload as object
    },
    update: {
      userId,
      status: "ACTIVE",
      expiresAt,
      rawPayload: rawPayload as object
    }
  });
}

export async function revokeEntitlement(
  userId: string,
  source: RealEntitlementSource,
  externalSubscriptionId: string,
  reason: string
): Promise<void> {
  await prisma.entitlement.upsert({
    where: {
      source_externalSubscriptionId: {
        source,
        externalSubscriptionId
      }
    },
    create: {
      userId,
      source,
      externalSubscriptionId,
      status: "CANCELED",
      expiresAt: new Date(),
      rawPayload: { reason }
    },
    update: {
      userId,
      status: "CANCELED",
      expiresAt: new Date(),
      rawPayload: { reason }
    }
  });
}

export async function getActiveEntitlement(userId: string): Promise<ActiveEntitlement | null> {
  if (env.DEV_FAKE_ENTITLEMENT === "true") {
    return {
      userId,
      source: "DEV",
      externalSubscriptionId: "dev-entitlement",
      expiresAt: null
    };
  }

  const now = new Date();
  const entitlements = await prisma.entitlement.findMany({
    where: {
      userId,
      status: "ACTIVE",
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: now } }
      ]
    },
    orderBy: {
      expiresAt: "desc"
    }
  });

  const active = entitlements[0];
  if (!active) {
    // PailPal-managed customers pay offline (no Stripe/PayPal entitlement) but are
    // fully entitled to the customer app by virtue of being managed + approved.
    const managed = await prisma.user.findUnique({
      where: { id: userId },
      select: { managedById: true }
    });
    if (managed?.managedById) {
      return {
        userId,
        source: "MANAGED",
        externalSubscriptionId: `managed:${managed.managedById}`,
        expiresAt: null
      };
    }
    return null;
  }

  const ordered = [...entitlements].sort((a, b) => expiresAtWeight(b.expiresAt) - expiresAtWeight(a.expiresAt));
  if (ordered.length > 1) {
    console.warn(
      `Multiple active entitlements found for user ${userId}; using latest expiry and flagging for manual reconciliation.`
    );
  }

  const winner = ordered[0];
  if (!winner) {
    return null;
  }

  return {
    userId: winner.userId,
    source: winner.source,
    externalSubscriptionId: winner.externalSubscriptionId,
    expiresAt: winner.expiresAt
  };
}
