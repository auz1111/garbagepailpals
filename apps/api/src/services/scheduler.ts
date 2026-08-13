import { DateTime } from "luxon";
import { prisma } from "@gpp/db";
import type { HaulerUpcoming } from "@gpp/shared";
import { env } from "../lib/env";
import { getUpcomingForAddress } from "./haulerSchedule";

type Cadence = "WEEKLY" | "BIWEEKLY";
type ServiceJobType = "CURB_OUT" | "CURB_IN";
type ServiceJobStatus = "SCHEDULED" | "SKIPPED";

type PickupDay = {
  pickupDayOfWeek: number;
  cadence: Cadence;
  biweeklyAnchorDate: Date | null;
  curbOutOffsetHours: number;
  rollIn: boolean;
  // Only days synced to the trash provider follow its holiday shifts/skips.
  providerSynced?: boolean;
};

type SchedulerAddress = {
  id: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  lat: unknown;
  lng: unknown;
  timezone: string;
  schedules: PickupDay[];
  holds: Array<{
    startDate: Date;
    endDate: Date;
  }>;
};

type SchedulerSubscription = {
  id: string;
  userId: string;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "PAUSED" | "CANCELED";
  serviceAddress: SchedulerAddress;
};

type HolidayRule = {
  municipality: string;
  date: Date;
  shiftDays: number;
};

type PendingJob = {
  serviceAddressId: string;
  subscriptionId: string;
  scheduledDate: Date;
  type: ServiceJobType;
  status: ServiceJobStatus;
  // The date this job would normally fall on, when a hauler holiday moved it.
  shiftedFromDate: Date | null;
  shiftReason: string | null;
};

// Prisma stores lat/lng as Decimal; normalize to a plain number for the hauler
// lookup (which needs coords for Republic's holiday endpoint).
function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  const maybe = value as { toNumber?: () => number };
  if (typeof maybe.toNumber === "function") {
    return maybe.toNumber();
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function shouldRunForAddressNow(timezone: string, now: Date): boolean {
  const localNow = DateTime.fromJSDate(now, { zone: timezone });
  return localNow.hour === 2;
}

function weekdayIndexFromLuxon(dt: DateTime): number {
  return dt.weekday % 7;
}

function isHoldCovered(date: DateTime, holds: SchedulerAddress["holds"]): boolean {
  return holds.some((hold) => {
    const start = DateTime.fromJSDate(hold.startDate).startOf("day");
    const end = DateTime.fromJSDate(hold.endDate).endOf("day");
    return date >= start && date <= end;
  });
}

function resolveShiftDays(date: DateTime, holidays: HolidayRule[]): number {
  const weekStart = date.startOf("week");
  const weekEnd = date.endOf("week");

  return holidays
    .filter((holiday) => {
      const holidayDate = DateTime.fromJSDate(holiday.date);
      return holidayDate >= weekStart && holidayDate <= weekEnd && holidayDate <= date;
    })
    .reduce((sum, holiday) => sum + holiday.shiftDays, 0);
}

function isBiweeklyMatch(targetDate: DateTime, anchorDate: Date): boolean {
  const anchor = DateTime.fromJSDate(anchorDate).startOf("day");
  const candidate = targetDate.startOf("day");
  const diffWeeks = Math.floor(candidate.diff(anchor, "days").days / 7);
  return diffWeeks % 2 === 0;
}

// The hauler's concrete garbage schedule for an address, distilled for
// reconciliation: which weekday is "normal" (the mode), the actual date per
// week, and the window the data covers.
type HaulerGarbage = {
  baseWeekday: number;
  byWeek: Map<number, DateTime>;
  from: DateTime;
  to: DateTime;
};

function parseHaulerGarbage(upcoming: HaulerUpcoming, zone: string): HaulerGarbage | null {
  const dates = upcoming.pickups
    .filter((p) => p.kind === "GARBAGE")
    .map((p) => DateTime.fromISO(p.date, { zone }).startOf("day"))
    .filter((d) => d.isValid);
  if (dates.length === 0) {
    return null;
  }
  const counts = new Map<number, number>();
  const byWeek = new Map<number, DateTime>();
  for (const d of dates) {
    const w = weekdayIndexFromLuxon(d);
    counts.set(w, (counts.get(w) ?? 0) + 1);
    const wk = d.startOf("week").toMillis();
    const existing = byWeek.get(wk);
    if (!existing || d < existing) {
      byWeek.set(wk, d);
    }
  }
  let baseWeekday = dates[0]!.weekday % 7;
  let best = -1;
  for (const [w, c] of counts) {
    if (c > best) {
      best = c;
      baseWeekday = w;
    }
  }
  return {
    baseWeekday,
    byWeek,
    from: DateTime.fromISO(upcoming.from, { zone }).startOf("day"),
    to: DateTime.fromISO(upcoming.to, { zone }).endOf("day")
  };
}

export function calculateJobsForAddress(
  subscriptionId: string,
  serviceAddressId: string,
  timezone: string,
  schedules: PickupDay[],
  holds: SchedulerAddress["holds"],
  holidays: HolidayRule[],
  lookaheadDays: number,
  referenceDate = new Date(),
  haulerUpcoming: HaulerUpcoming | null = null
): PendingJob[] {
  const start = DateTime.fromJSDate(referenceDate, { zone: timezone }).startOf("day");
  const jobs: PendingJob[] = [];
  const hauler = haulerUpcoming ? parseHaulerGarbage(haulerUpcoming, timezone) : null;

  // Emit the curb-out (and, if kept, next-day curb-in) for a pickup landing on
  // `effective`. `shiftedFrom` carries the would-be normal date when shifted.
  const emit = (
    effective: DateTime,
    pickup: PickupDay,
    shiftedFrom: DateTime | null,
    reason: string | null
  ): void => {
    const curbOut = effective.plus({ hours: pickup.curbOutOffsetHours });
    jobs.push({
      serviceAddressId,
      subscriptionId,
      scheduledDate: curbOut.toUTC().toJSDate(),
      type: "CURB_OUT",
      status: "SCHEDULED",
      shiftedFromDate: shiftedFrom
        ? shiftedFrom.plus({ hours: pickup.curbOutOffsetHours }).toUTC().toJSDate()
        : null,
      shiftReason: reason
    });
    if (pickup.rollIn) {
      const curbIn = effective.plus({ days: 1, hours: 8 });
      jobs.push({
        serviceAddressId,
        subscriptionId,
        scheduledDate: curbIn.toUTC().toJSDate(),
        type: "CURB_IN",
        status: "SCHEDULED",
        shiftedFromDate: shiftedFrom ? shiftedFrom.plus({ days: 1, hours: 8 }).toUTC().toJSDate() : null,
        shiftReason: reason
      });
    }
  };

  // Each pickup day carries its own weekday, cadence, and roll-in choice.
  for (const pickup of schedules) {
    // Reconcile against the trash provider only for days the customer/admin
    // synced to it (their weekday tracks the provider's collection day); other
    // days keep the standard behavior.
    const reconcile = hauler !== null && pickup.providerSynced === true;

    for (let i = 0; i < lookaheadDays; i += 1) {
      const day = start.plus({ days: i });

      if (reconcile && hauler) {
        // `day` is the normal collection weekday; look up the hauler's actual
        // date that week to shift/skip.
        if (weekdayIndexFromLuxon(day) !== pickup.pickupDayOfWeek) {
          continue;
        }
        if (
          pickup.cadence === "BIWEEKLY" &&
          (!pickup.biweeklyAnchorDate || !isBiweeklyMatch(day, pickup.biweeklyAnchorDate))
        ) {
          continue;
        }

        if (day >= hauler.from && day <= hauler.to) {
          const actual = hauler.byWeek.get(day.startOf("week").toMillis()) ?? null;
          if (!actual) {
            // Hauler skips collection this week — leave a skipped marker so the
            // customer sees "no pickup" and routing ignores it.
            if (!isHoldCovered(day, holds)) {
              jobs.push({
                serviceAddressId,
                subscriptionId,
                scheduledDate: day.plus({ hours: pickup.curbOutOffsetHours }).toUTC().toJSDate(),
                type: "CURB_OUT",
                status: "SKIPPED",
                shiftedFromDate: null,
                shiftReason: "No collection this week (provider holiday)"
              });
            }
            continue;
          }
          if (isHoldCovered(actual, holds)) {
            continue;
          }
          const shifted = !actual.hasSame(day, "day");
          emit(actual, pickup, shifted ? day : null, shifted ? "Holiday-adjusted pickup" : null);
        } else {
          // Beyond the hauler data window — fall back to the normal date.
          if (!isHoldCovered(day, holds)) {
            emit(day, pickup, null, null);
          }
        }
        continue;
      }

      // Standard path (unmatched addresses, or non-hauler pickup days): shift by
      // the manual city HolidayCalendar rules, if any.
      const shiftedDay = day.minus({ days: resolveShiftDays(day, holidays) });
      if (weekdayIndexFromLuxon(shiftedDay) !== pickup.pickupDayOfWeek) {
        continue;
      }
      if (pickup.cadence === "BIWEEKLY") {
        if (!pickup.biweeklyAnchorDate || !isBiweeklyMatch(day, pickup.biweeklyAnchorDate)) {
          continue;
        }
      }
      if (isHoldCovered(day, holds)) {
        continue;
      }
      emit(day, pickup, null, null);
    }
  }

  return jobs;
}

export async function runNightlyJobGeneration(
  now = new Date(),
  options: { force?: boolean; userId?: string } = {}
): Promise<{ created: number }> {
  const lookahead = env.SCHEDULER_LOOKAHEAD_DAYS;

  const subscriptions = (await prisma.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "TRIALING"] },
      serviceAddress: { isActive: true },
      ...(options.userId ? { userId: options.userId } : {})
    },
    include: {
      serviceAddress: {
        include: {
          schedules: true,
          holds: true
        }
      }
    }
  })) as unknown as SchedulerSubscription[];

  const holidays = await prisma.holidayCalendar.findMany({
    where: {
      date: {
        gte: now,
        lte: new Date(now.getTime() + lookahead * 24 * 60 * 60 * 1000)
      }
    }
  });

  let created = 0;

  for (const subscription of subscriptions) {
    if (!options.force && !shouldRunForAddressNow(subscription.serviceAddress.timezone, now)) {
      continue;
    }

    const schedules = subscription.serviceAddress.schedules;
    if (!schedules || schedules.length === 0) {
      continue;
    }

    const applicableHolidays = holidays.filter(
      (holiday: any) => holiday.municipality.toLowerCase() === subscription.serviceAddress.city.toLowerCase()
    );

    // Pull the hauler's concrete, holiday-accurate dates (cached; refreshed only
    // when coverage runs short). Returns null for addresses with no hauler match,
    // in which case generation falls back to the normal weekday/cadence.
    const address = subscription.serviceAddress;
    const requiredThrough = new Date(now.getTime() + lookahead * 24 * 60 * 60 * 1000);
    const haulerUpcoming = await getUpcomingForAddress(
      {
        line1: address.line1,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode
      },
      requiredThrough,
      { lat: toNumber(address.lat), lng: toNumber(address.lng) }
    ).catch(() => null);

    const jobs = calculateJobsForAddress(
      subscription.id,
      subscription.serviceAddress.id,
      subscription.serviceAddress.timezone,
      schedules,
      subscription.serviceAddress.holds,
      applicableHolidays,
      lookahead,
      now,
      haulerUpcoming
    );

    for (const job of jobs) {
      await prisma.serviceJob.upsert({
        where: {
          serviceAddressId_scheduledDate_type: {
            serviceAddressId: job.serviceAddressId,
            scheduledDate: job.scheduledDate,
            type: job.type
          }
        },
        create: {
          serviceAddressId: job.serviceAddressId,
          subscriptionId: job.subscriptionId,
          scheduledDate: job.scheduledDate,
          type: job.type,
          status: job.status,
          shiftedFromDate: job.shiftedFromDate,
          shiftReason: job.shiftReason
        },
        update: {}
      });
      created += 1;
    }
  }

  return { created };
}
