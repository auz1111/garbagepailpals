import { prisma } from "@gpp/db";
import { env } from "../lib/env";

export type ActiveEntitlement = {
  userId: string;
  source: "STRIPE" | "PAYPAL" | "REVENUECAT" | "DEV";
  externalSubscriptionId: string;
  expiresAt: Date | null;
};

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
    return null;
  }

  return {
    userId: active.userId,
    source: active.source,
    externalSubscriptionId: active.externalSubscriptionId,
    expiresAt: active.expiresAt
  };
}
