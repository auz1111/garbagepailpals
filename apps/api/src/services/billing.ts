import { prisma } from "@gpp/db";
import { addressMonthlyCents, monthlyTotalCents } from "@gpp/shared";

// Authoritative monthly charge for a user, derived from their active service
// addresses (cans + pickups/week). This is the single source of truth for what
// Stripe / PayPal charge — the client-displayed estimate uses the same formula.
export async function computeUserMonthlyCents(userId: string): Promise<number> {
  const addresses = await prisma.serviceAddress.findMany({
    where: { userId, isActive: true },
    select: { canCount: true, pickupsPerWeek: true }
  });

  return monthlyTotalCents(addresses);
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// On payment activation, create/refresh one internal subscription per active
// address so the scheduler generates jobs. One external processor subscription
// covers all of a user's addresses.
export async function activateSubscriptionsForUser(
  userId: string,
  opts: {
    source: "STRIPE" | "PAYPAL";
    externalSubscriptionId: string | null;
    currentPeriodEnd: Date | null;
    status?: "ACTIVE" | "TRIALING";
  }
): Promise<void> {
  const addresses = await prisma.serviceAddress.findMany({
    where: { userId, isActive: true },
    select: { id: true, canCount: true, pickupsPerWeek: true }
  });

  const now = new Date();
  const periodEnd = opts.currentPeriodEnd ?? new Date(now.getTime() + MONTH_MS);
  const status = opts.status ?? "ACTIVE";

  for (const address of addresses) {
    const amountCents = addressMonthlyCents(address);
    await prisma.subscription.upsert({
      where: { userId_serviceAddressId: { userId, serviceAddressId: address.id } },
      create: {
        userId,
        serviceAddressId: address.id,
        planId: null,
        source: opts.source,
        externalSubscriptionId: opts.externalSubscriptionId,
        amountCents,
        status,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false
      },
      update: {
        source: opts.source,
        externalSubscriptionId: opts.externalSubscriptionId,
        amountCents,
        status,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false
      }
    });
  }
}

// On cancellation / payment failure, flip the user's subscriptions so the
// scheduler stops generating new jobs.
export async function deactivateSubscriptionsForUser(
  userId: string,
  status: "CANCELED" | "PAST_DUE" | "PAUSED"
): Promise<void> {
  await prisma.subscription.updateMany({
    where: { userId },
    data: { status, cancelAtPeriodEnd: status === "CANCELED" }
  });
}
