import { prisma } from "@gpp/db";
import { addressMonthlyCents, monthlyTotalCents, type BillingSummary } from "@gpp/shared";

const ACTIVE_STATUSES = ["ACTIVE", "TRIALING"] as const;

// Billing overview for a user: subscription status + per-address coverage,
// so the UI can show whether billing is active and which addresses aren't yet
// on the paid plan.
export async function getBillingSummary(userId: string): Promise<BillingSummary> {
  const [addresses, subscriptions] = await Promise.all([
    prisma.serviceAddress.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.subscription.findMany({ where: { userId } })
  ]);

  const subByAddress = new Map(subscriptions.map((sub) => [sub.serviceAddressId, sub]));

  const addressSummaries = addresses.map((address) => {
    const sub = subByAddress.get(address.id);
    const covered = sub ? ACTIVE_STATUSES.includes(sub.status as (typeof ACTIVE_STATUSES)[number]) : false;
    return {
      id: address.id,
      line1: address.line1,
      city: address.city,
      canCount: address.canCount,
      pickupsPerWeek: address.pickupsPerWeek,
      monthlyCents: addressMonthlyCents(address),
      covered,
      status: sub?.status ?? null
    };
  });

  const activeSubs = subscriptions.filter((sub) =>
    ACTIVE_STATUSES.includes(sub.status as (typeof ACTIVE_STATUSES)[number])
  );
  const latestPeriodEnd = activeSubs
    .map((sub) => sub.currentPeriodEnd.getTime())
    .sort((a, b) => a - b)
    .at(-1);

  const active = addressSummaries.some((a) => a.covered);
  const totalMonthlyCents = addressSummaries.reduce((sum, a) => sum + a.monthlyCents, 0);
  // What the processor is actually charging today (stored at last activation/sync).
  const billedMonthlyCents = activeSubs.reduce((sum, sub) => sum + (sub.amountCents ?? 0), 0);

  return {
    active,
    pastDue: subscriptions.some((sub) => sub.status === "PAST_DUE"),
    source: activeSubs[0]?.source ?? null,
    currentPeriodEnd: latestPeriodEnd !== undefined ? new Date(latestPeriodEnd).toISOString() : null,
    coveredMonthlyCents: addressSummaries.filter((a) => a.covered).reduce((sum, a) => sum + a.monthlyCents, 0),
    totalMonthlyCents,
    billedMonthlyCents,
    // Billed amount drifted from current addresses (added address or changed cans/pickups).
    needsUpdate: active && billedMonthlyCents !== totalMonthlyCents,
    uncoveredCount: addressSummaries.filter((a) => !a.covered).length,
    addresses: addressSummaries
  };
}

// Authoritative monthly charge for a user, derived from their active service
// addresses (cans + pickups/week). This is the single source of truth for what
// Stripe / PayPal charge — the client-displayed estimate uses the same formula.
export async function computeUserMonthlyCents(userId: string): Promise<number> {
  const addresses = await prisma.serviceAddress.findMany({
    where: { userId, isActive: true },
    select: { canCount: true, pickupsPerWeek: true, rollIn: true }
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
    select: { id: true, canCount: true, pickupsPerWeek: true, rollIn: true }
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
