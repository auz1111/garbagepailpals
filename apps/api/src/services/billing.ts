import { prisma } from "@gpp/db";
import {
  locationServicesMonthlyCents,
  scheduleCanSchema,
  type BillingSummary,
  type ScheduleCan,
  type ServicePricing,
  type ServiceType
} from "@gpp/shared";
import { z } from "zod";

const ACTIVE_STATUSES = ["ACTIVE", "TRIALING"] as const;

const cansArraySchema = z.array(scheduleCanSchema);

// Parse the stored cans JSON; fall back to empty so pricing never throws.
function parseCans(cans: unknown): ScheduleCan[] {
  const parsed = cansArraySchema.safeParse(cans);
  return parsed.success ? parsed.data : [];
}

// The generic service model as loaded from the DB (LocationService + days).
type LocationServiceRow = {
  type: string;
  days: { dayOfWeek: number; cadence: string; cans: unknown; rollIn: boolean }[];
};

// What Prisma include to attach to a serviceAddress to price it.
const SERVICES_INCLUDE = { locationServices: { include: { days: true } } } as const;

function toServicePricing(services: LocationServiceRow[]): ServicePricing[] {
  return services.map((s) => ({
    type: s.type as ServiceType,
    days: s.days.map((d) => ({
      dayOfWeek: d.dayOfWeek,
      cadence: d.cadence as "WEEKLY" | "BIWEEKLY",
      cans: parseCans(d.cans),
      rollIn: d.rollIn
    }))
  }));
}

// A location's monthly total from its services (the single billing source).
function addressServiceMonthly(services: LocationServiceRow[]): number {
  return locationServicesMonthlyCents(toServicePricing(services));
}

// Distinct weekdays that have any service (for the "pickups/week" display).
function serviceWeekdayCount(services: LocationServiceRow[]): number {
  const weekdays = new Set<number>();
  for (const s of services) for (const d of s.days) weekdays.add(d.dayOfWeek);
  return weekdays.size;
}

// Billing overview for a user: subscription status + per-address coverage,
// so the UI can show whether billing is active and which addresses aren't yet
// on the paid plan.
export async function getBillingSummary(userId: string): Promise<BillingSummary> {
  const [addresses, subscriptions] = await Promise.all([
    prisma.serviceAddress.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: "asc" },
      include: SERVICES_INCLUDE
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
      pickupsPerWeek: serviceWeekdayCount(address.locationServices),
      monthlyCents: addressServiceMonthly(address.locationServices),
      covered,
      serviceApproved: address.serviceApprovedAt != null,
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
    include: SERVICES_INCLUDE
  });

  return addresses.reduce(
    (sum, address) => sum + addressServiceMonthly(address.locationServices),
    0
  );
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
    include: SERVICES_INCLUDE
  });

  const now = new Date();
  const periodEnd = opts.currentPeriodEnd ?? new Date(now.getTime() + MONTH_MS);
  const status = opts.status ?? "ACTIVE";

  for (const address of addresses) {
    const amountCents = addressServiceMonthly(address.locationServices);
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
