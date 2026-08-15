import { prisma } from "@gpp/db";
import type { CanType, HaulerUpcoming, PickupStream, ScheduleCan, ServiceType } from "@gpp/shared";
import { haulerUpcomingSchema, scheduleCanSchema } from "@gpp/shared";
import { z } from "zod";
import { biweeklyMatchesZoned, resolveZone, weekdayInZone, zonedDay } from "../lib/timezone";
import { describeProviders, haulerAddressHash } from "./haulerSchedule";
import { parseHaulerStreams } from "./providerReconcile";

const ACTIVE_SUB_STATUSES: ("ACTIVE" | "TRIALING")[] = ["ACTIVE", "TRIALING"];

const cansArraySchema = z.array(scheduleCanSchema);
function parseCans(value: unknown): ScheduleCan[] {
  const parsed = cansArraySchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

// Which provider collection stream a can type corresponds to (glass rides along
// with the yard stream, since haulers bundle glass into yard waste).
function canTypeToStreamKind(type: CanType): PickupStream["kind"] {
  switch (type) {
    case "TRASH":
      return "GARBAGE";
    case "RECYCLING":
      return "RECYCLING";
    case "YARD":
    case "GLASS":
      return "YARD";
    default:
      return "GARBAGE";
  }
}

const SERVICE_ADDRESS_INCLUDE = {
  schedules: true,
  locationServices: { include: { days: true } },
  user: { select: { id: true, name: true, managedById: true } },
  neighborhood: { select: { name: true } },
  subscriptions: { where: { status: { in: ACTIVE_SUB_STATUSES } }, take: 1 }
} as const;

type AddressRow = Awaited<ReturnType<typeof loadServiceableAddresses>>[number];
type ScheduleRow = AddressRow["schedules"][number];

// ownerId scopes to a PailPal's own managed customers (used for their self-only
// route building). Without it, the global set is active-subscription customers
// plus any PailPal-managed customer (who pay offline, so have no subscription).
export type WorkScope = { neighborhoodId?: string; zoneIds?: string[]; ownerId?: string };

// Provider health for one roll action (roll-out or roll-in) at an address:
//   NOT_SYNCED    — this pickup day isn't tied to a trash provider
//   NORMAL        — provider collects on the expected day
//   SHIFTED       — provider moved the pickup (so this action moves off today)
//   NO_COLLECTION — provider skips this week (holiday)
//   UNKNOWN       — day is provider-synced but we have no cached provider data
export type ActionProviderStatus =
  | "NOT_SYNCED"
  | "NORMAL"
  | "SHIFTED"
  | "NO_COLLECTION"
  | "UNKNOWN";

type ReconciledAction = {
  // Whether this roll action is actually due today (drives routing).
  due: boolean;
  schedule: ScheduleRow | null;
  // The cans actually collected on this action's date (weekly cans always; a
  // biweekly can only on its on-week — reconciled to the provider's per-stream
  // dates when synced). Empty when the action isn't due.
  cans: ScheduleCan[];
  providerStatus: ActionProviderStatus;
  // ISO date the provider actually collects, when SHIFTED.
  shiftedTo: string | null;
};

// A non-trash service due today at an address (same-day visit — no roll).
export type DueService = { type: ServiceType; options: Record<string, unknown> };

export type ReconciledWork = {
  address: AddressRow;
  subscriptionId: string;
  provider: { id: string | null; label: string | null };
  rollOut: ReconciledAction;
  rollIn: ReconciledAction;
  // Non-trash services (mail check, watering, pet waste) due today.
  services: DueService[];
};

async function loadServiceableAddresses(scope: WorkScope) {
  return prisma.serviceAddress.findMany({
    where: {
      isActive: true,
      // Only approved locations are serviceable (routable / counted).
      serviceApprovedAt: { not: null },
      ...(scope.neighborhoodId ? { neighborhoodId: scope.neighborhoodId } : {}),
      ...(scope.zoneIds ? { neighborhood: { zoneId: { in: scope.zoneIds } } } : {}),
      // A PailPal building their own route sees only their managed customers (who
      // pay offline, so we don't require a subscription). Otherwise the set is
      // active-subscription customers OR any PailPal-managed customer.
      ...(scope.ownerId
        ? { user: { managedById: scope.ownerId } }
        : {
            OR: [
              { subscriptions: { some: { status: { in: ACTIVE_SUB_STATUSES } } } },
              { user: { managedById: { not: null } } }
            ]
          }),
      schedules: { some: {} }
    },
    include: SERVICE_ADDRESS_INCLUDE
  });
}

// Load the cached provider schedules (holiday-accurate concrete dates) for a set
// of addresses, keyed by their address hash.
async function loadStreamsByHash(
  addresses: AddressRow[]
): Promise<Map<string, { provider: string | null; upcoming: HaulerUpcoming }>> {
  const hashes = [
    ...new Set(
      addresses.map((a) =>
        haulerAddressHash({ line1: a.line1, city: a.city, state: a.state, postalCode: a.postalCode })
      )
    )
  ];
  const rows = await prisma.haulerScheduleLookup
    .findMany({ where: { addressHash: { in: hashes } } })
    .catch(() => []);
  const out = new Map<string, { provider: string | null; upcoming: HaulerUpcoming }>();
  for (const row of rows) {
    if (!row.upcomingPickups) continue;
    const parsed = haulerUpcomingSchema.safeParse(row.upcomingPickups);
    if (parsed.success) {
      out.set(row.addressHash, { provider: row.provider ?? null, upcoming: parsed.data });
    }
  }
  return out;
}

// Whether a schedule lands on `weekday` this cycle (weekly, or a biweekly whose
// anchor puts `day` on an "on" week) — the provider-agnostic weekday rule.
function weekdayMatch(s: ScheduleRow, weekday: number, day: ReturnType<typeof zonedDay>): boolean {
  return (
    s.pickupDayOfWeek === weekday &&
    (s.cadence === "WEEKLY" || biweeklyMatchesZoned(s.biweeklyAnchorDate, day))
  );
}

// Reconcile every serviceable address for the operating day `now` into the roll
// actions actually due today, holiday-aware for provider-synced pickup days.
// This is the single source of truth shared by route building and the admin
// day-status panel, so routes and the "is today on track?" view always agree.
export async function reconcileTodaysWork(now: Date, scope: WorkScope = {}): Promise<ReconciledWork[]> {
  const addresses = await loadServiceableAddresses(scope);
  const streamsByHash = await loadStreamsByHash(addresses);
  const providerLabel = (id: string | null): string | null =>
    id ? describeProviders().find((p) => p.id === id)?.label ?? id : null;

  const result: ReconciledWork[] = [];
  for (const a of addresses) {
    // PailPal-managed customers pay offline and have no Subscription row; use a
    // synthetic id for them (it's only a reference label — never persisted).
    const subscriptionId =
      a.subscriptions[0]?.id ?? (a.user.managedById ? `managed:${a.user.managedById}` : null);
    if (!subscriptionId) continue;

    const zone = resolveZone(a.timezone);
    // Roll OUT the evening before pickup → pickups scheduled TOMORROW.
    // Roll IN the same day as pickup, after collection → pickups scheduled TODAY.
    const rollOutWeekday = weekdayInZone(now, zone, 1);
    const rollInWeekday = weekdayInZone(now, zone, 0);
    const rollOutDay = zonedDay(now, zone, 1);
    const rollInDay = zonedDay(now, zone, 0);

    const hash = haulerAddressHash({
      line1: a.line1,
      city: a.city,
      state: a.state,
      postalCode: a.postalCode
    });
    const cached = streamsByHash.get(hash);
    const streams = cached ? parseHaulerStreams(cached.upcoming, zone) : null;

    // The cans actually collected at this address on a given date: for a synced
    // schedule, keep only cans whose stream the provider collects that date (so a
    // biweekly recycling can drops on its off-week); otherwise keep all the day's
    // cans. Falls back to the full list if filtering would leave nothing.
    const dueCansFor = (s: ScheduleRow, day: ReturnType<typeof zonedDay>): ScheduleCan[] => {
      const all = parseCans(s.cans);
      if (!s.providerSynced || !cached) {
        return all;
      }
      const dayIso = day.toISODate();
      const kinds = new Set(
        cached.upcoming.pickups
          .filter((p) => p.date.slice(0, 10) === dayIso)
          .map((p) => p.kind)
      );
      if (kinds.size === 0) {
        return all;
      }
      const filtered = all.filter((c) => kinds.has(canTypeToStreamKind(c.type)));
      return filtered.length > 0 ? filtered : all;
    };

    // Reconcile one roll action (roll-out for tomorrow's pickup, roll-in for
    // today's — after collection) against the provider's actual dates when the
    // day is synced.
    const reconcileAction = (
      weekday: number,
      day: ReturnType<typeof zonedDay>,
      requireRollIn: boolean
    ): ReconciledAction => {
      for (const s of a.schedules) {
        if (requireRollIn && !s.rollIn) continue;

        if (s.providerSynced) {
          const stream = streams?.get(s.pickupDayOfWeek);
          if (!stream || day < stream.from || day > stream.to) {
            // Synced but no usable data for this day → fall back to the weekday
            // rule and flag it Unknown so the panel doesn't claim "on schedule".
            if (weekdayMatch(s, weekday, day)) {
              return { due: true, schedule: s, cans: dueCansFor(s, day), providerStatus: "UNKNOWN", shiftedTo: null };
            }
            continue;
          }
          // Provider is the source of truth: this action is due today iff the
          // provider actually collects on `day`.
          const actual = stream.byWeek.get(day.startOf("week").toMillis()) ?? null;
          if (actual && actual.hasSame(day, "day")) {
            const shifted = s.pickupDayOfWeek !== weekday;
            return {
              due: true,
              schedule: s,
              cans: dueCansFor(s, day),
              providerStatus: shifted ? "SHIFTED" : "NORMAL",
              shiftedTo: shifted ? actual.toISODate() : null
            };
          }
          // Not due today for this synced schedule. Record WHY only when today
          // is its NORMAL day (so the panel can flag shifts/skips affecting today).
          if (s.pickupDayOfWeek === weekday) {
            if (!actual) {
              // A missing week is only a "no collection" (holiday) for a WEEKLY
              // pickup. For a BIWEEKLY pickup this is just an off-week — normal,
              // not a provider outage.
              return {
                due: false,
                schedule: s,
                cans: [],
                providerStatus: s.cadence === "WEEKLY" ? "NO_COLLECTION" : "NORMAL",
                shiftedTo: null
              };
            }
            return {
              due: false,
              schedule: s,
              cans: [],
              providerStatus: "SHIFTED",
              shiftedTo: actual.toISODate()
            };
          }
          continue;
        }

        // Unsynced pickup day → provider-agnostic weekday rule.
        if (weekdayMatch(s, weekday, day)) {
          return { due: true, schedule: s, cans: dueCansFor(s, day), providerStatus: "NOT_SYNCED", shiftedTo: null };
        }
      }
      return { due: false, schedule: null, cans: [], providerStatus: "NOT_SYNCED", shiftedTo: null };
    };

    const rollOut = reconcileAction(rollOutWeekday, rollOutDay, false);
    const rollIn = reconcileAction(rollInWeekday, rollInDay, true);

    // Non-trash services are same-day visits: due when one of their days lands on
    // today's weekday (biweekly aligned to its anchor).
    const services: DueService[] = [];
    for (const svc of a.locationServices) {
      if (svc.type === "TRASH" || !svc.isActive) continue;
      const due = svc.days.some(
        (d) =>
          d.dayOfWeek === rollInWeekday &&
          (d.cadence === "WEEKLY" || biweeklyMatchesZoned(d.biweeklyAnchorDate, rollInDay))
      );
      if (due) {
        services.push({
          type: svc.type as ServiceType,
          options: (svc.options as Record<string, unknown>) ?? {}
        });
      }
    }

    if (
      rollOut.providerStatus === "NOT_SYNCED" &&
      rollIn.providerStatus === "NOT_SYNCED" &&
      !rollOut.due &&
      !rollIn.due &&
      services.length === 0
    ) {
      // Nothing today and nothing provider-relevant to report.
      continue;
    }

    result.push({
      address: a,
      subscriptionId,
      provider: { id: cached?.provider ?? null, label: providerLabel(cached?.provider ?? null) },
      rollOut,
      rollIn,
      services
    });
  }
  return result;
}
