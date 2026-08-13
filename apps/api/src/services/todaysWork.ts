import { prisma } from "@gpp/db";
import type { HaulerUpcoming } from "@gpp/shared";
import { haulerUpcomingSchema } from "@gpp/shared";
import { biweeklyMatchesZoned, resolveZone, weekdayInZone, zonedDay } from "../lib/timezone";
import { describeProviders, haulerAddressHash } from "./haulerSchedule";
import { parseHaulerStreams } from "./providerReconcile";

const ACTIVE_SUB_STATUSES: ("ACTIVE" | "TRIALING")[] = ["ACTIVE", "TRIALING"];

const SERVICE_ADDRESS_INCLUDE = {
  schedules: true,
  user: { select: { id: true, name: true } },
  neighborhood: { select: { name: true } },
  subscriptions: { where: { status: { in: ACTIVE_SUB_STATUSES } }, take: 1 }
} as const;

type AddressRow = Awaited<ReturnType<typeof loadServiceableAddresses>>[number];
type ScheduleRow = AddressRow["schedules"][number];

export type WorkScope = { neighborhoodId?: string; zoneIds?: string[] };

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
  providerStatus: ActionProviderStatus;
  // ISO date the provider actually collects, when SHIFTED.
  shiftedTo: string | null;
};

export type ReconciledWork = {
  address: AddressRow;
  subscriptionId: string;
  provider: { id: string | null; label: string | null };
  rollOut: ReconciledAction;
  rollIn: ReconciledAction;
};

async function loadServiceableAddresses(scope: WorkScope) {
  return prisma.serviceAddress.findMany({
    where: {
      isActive: true,
      // Only admin-approved locations are serviceable (routable / counted).
      serviceApprovedAt: { not: null },
      ...(scope.neighborhoodId ? { neighborhoodId: scope.neighborhoodId } : {}),
      ...(scope.zoneIds ? { neighborhood: { zoneId: { in: scope.zoneIds } } } : {}),
      subscriptions: { some: { status: { in: ACTIVE_SUB_STATUSES } } },
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
    const subscriptionId = a.subscriptions[0]?.id;
    if (!subscriptionId) continue;

    const zone = resolveZone(a.timezone);
    const rollOutWeekday = weekdayInZone(now, zone, 1);
    const rollInWeekday = weekdayInZone(now, zone, -1);
    const rollOutDay = zonedDay(now, zone, 1);
    const rollInDay = zonedDay(now, zone, -1);

    const hash = haulerAddressHash({
      line1: a.line1,
      city: a.city,
      state: a.state,
      postalCode: a.postalCode
    });
    const cached = streamsByHash.get(hash);
    const streams = cached ? parseHaulerStreams(cached.upcoming, zone) : null;

    // Reconcile one roll action (roll-out for tomorrow's pickup, roll-in for
    // yesterday's) against the provider's actual dates when the day is synced.
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
              return { due: true, schedule: s, providerStatus: "UNKNOWN", shiftedTo: null };
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
              providerStatus: shifted ? "SHIFTED" : "NORMAL",
              shiftedTo: shifted ? actual.toISODate() : null
            };
          }
          // Not due today for this synced schedule. Record WHY only when today
          // is its NORMAL day (so the panel can flag shifts/skips affecting today).
          if (s.pickupDayOfWeek === weekday) {
            if (!actual) {
              return { due: false, schedule: s, providerStatus: "NO_COLLECTION", shiftedTo: null };
            }
            return {
              due: false,
              schedule: s,
              providerStatus: "SHIFTED",
              shiftedTo: actual.toISODate()
            };
          }
          continue;
        }

        // Unsynced pickup day → provider-agnostic weekday rule.
        if (weekdayMatch(s, weekday, day)) {
          return { due: true, schedule: s, providerStatus: "NOT_SYNCED", shiftedTo: null };
        }
      }
      return { due: false, schedule: null, providerStatus: "NOT_SYNCED", shiftedTo: null };
    };

    const rollOut = reconcileAction(rollOutWeekday, rollOutDay, false);
    const rollIn = reconcileAction(rollInWeekday, rollInDay, true);

    if (
      rollOut.providerStatus === "NOT_SYNCED" &&
      rollIn.providerStatus === "NOT_SYNCED" &&
      !rollOut.due &&
      !rollIn.due
    ) {
      // Nothing today and nothing provider-relevant to report.
      continue;
    }

    result.push({
      address: a,
      subscriptionId,
      provider: { id: cached?.provider ?? null, label: providerLabel(cached?.provider ?? null) },
      rollOut,
      rollIn
    });
  }
  return result;
}
