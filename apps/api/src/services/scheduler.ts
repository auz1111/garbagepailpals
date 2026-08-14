import { DateTime } from "luxon";
import type { HaulerUpcoming } from "@gpp/shared";
import { parseHaulerStreams, weekdayIndexFromLuxon } from "./providerReconcile";

type Cadence = "WEEKLY" | "BIWEEKLY";
type ServiceJobType = "CURB_OUT" | "CURB_IN";
type ServiceJobStatus = "SCHEDULED" | "SKIPPED";

// Roll-in happens the SAME day as pickup, after the hauler has collected. We
// schedule it late afternoon (local) so it lands after typical collection times.
const CURB_IN_HOUR_LOCAL = 18;

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
  const streams = haulerUpcoming ? parseHaulerStreams(haulerUpcoming, timezone) : null;

  // Emit the curb-out (the evening before) and, if kept, the SAME-day curb-in
  // (after the hauler collects) for a pickup landing on `effective`.
  // `shiftedFrom` carries the would-be normal date when shifted.
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
      // Same day as pickup, late afternoon — after collection.
      const curbIn = effective.set({ hour: CURB_IN_HOUR_LOCAL, minute: 0, second: 0, millisecond: 0 });
      jobs.push({
        serviceAddressId,
        subscriptionId,
        scheduledDate: curbIn.toUTC().toJSDate(),
        type: "CURB_IN",
        status: "SCHEDULED",
        shiftedFromDate: shiftedFrom
          ? shiftedFrom.set({ hour: CURB_IN_HOUR_LOCAL, minute: 0, second: 0, millisecond: 0 }).toUTC().toJSDate()
          : null,
        shiftReason: reason
      });
    }
  };

  // Each pickup day carries its own weekday, cadence, and roll-in choice.
  for (const pickup of schedules) {
    // Reconcile against the trash provider only for days the customer/admin
    // synced to it — and only when the provider actually collects something on
    // that day's weekday. Other days keep the standard behavior.
    const stream =
      streams && pickup.providerSynced === true ? streams.get(pickup.pickupDayOfWeek) : undefined;
    const reconcile = Boolean(stream);

    for (let i = 0; i < lookaheadDays; i += 1) {
      const day = start.plus({ days: i });

      if (reconcile && stream) {
        // `day` is the normal collection weekday; look up the provider's actual
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

        if (day >= stream.from && day <= stream.to) {
          const actual = stream.byWeek.get(day.startOf("week").toMillis()) ?? null;
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
