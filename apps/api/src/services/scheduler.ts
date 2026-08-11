import { DateTime } from "luxon";
import { prisma } from "@gpp/db";
import { env } from "../lib/env";

type Cadence = "WEEKLY" | "BIWEEKLY";
type ServiceJobType = "CURB_OUT" | "CURB_IN";

type SchedulerAddress = {
  id: string;
  city: string;
  timezone: string;
  pickupsPerWeek: number;
  rollIn: boolean;
  schedule: {
    pickupDayOfWeek: number;
    cadence: Cadence;
    biweeklyAnchorDate: Date | null;
    curbOutOffsetHours: number;
    curbInOffsetHours: number;
  } | null;
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
};

export function shouldRunForAddressNow(timezone: string, now: Date): boolean {
  const localNow = DateTime.fromJSDate(now, { zone: timezone });
  return localNow.hour === 2;
}

function weekdayIndexFromLuxon(dt: DateTime): number {
  return dt.weekday % 7;
}

// Spread N pickups evenly across the week, anchored at the primary pickup day.
// e.g. Tue + 2/week -> [Tue, Fri]; Tue + 3/week -> [Tue, Thu, Sat].
export function computePickupWeekdays(primaryDay: number, pickupsPerWeek: number): number[] {
  const count = Math.min(7, Math.max(1, Math.floor(pickupsPerWeek || 1)));
  const days = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const offset = Math.floor((i * 7) / count);
    days.add((primaryDay + offset) % 7);
  }
  return [...days].sort((a, b) => a - b);
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

export function calculateJobsForAddress(
  subscriptionId: string,
  serviceAddressId: string,
  timezone: string,
  schedule: NonNullable<SchedulerAddress["schedule"]>,
  holds: SchedulerAddress["holds"],
  holidays: HolidayRule[],
  lookaheadDays: number,
  referenceDate = new Date(),
  pickupsPerWeek = 1,
  rollIn = true
): PendingJob[] {
  const start = DateTime.fromJSDate(referenceDate, { zone: timezone }).startOf("day");
  const jobs: PendingJob[] = [];
  const pickupWeekdays = computePickupWeekdays(schedule.pickupDayOfWeek, pickupsPerWeek);

  for (let i = 0; i < lookaheadDays; i += 1) {
    const day = start.plus({ days: i });
    const shiftedDay = day.minus({ days: resolveShiftDays(day, holidays) });
    const matchesWeekday = pickupWeekdays.includes(weekdayIndexFromLuxon(shiftedDay));

    if (!matchesWeekday) {
      continue;
    }

    if (schedule.cadence === "BIWEEKLY") {
      if (!schedule.biweeklyAnchorDate || !isBiweeklyMatch(day, schedule.biweeklyAnchorDate)) {
        continue;
      }
    }

    if (isHoldCovered(day, holds)) {
      continue;
    }

    const curbOut = day.plus({ hours: schedule.curbOutOffsetHours });

    jobs.push({
      serviceAddressId,
      subscriptionId,
      scheduledDate: curbOut.toUTC().toJSDate(),
      type: "CURB_OUT"
    });

    // Roll-in is optional: when the customer keeps it, we bring the cans back the
    // day after pickup. When they opt out, no roll-in job is generated.
    if (rollIn) {
      const curbIn = day.plus({ days: 1, hours: 8 });
      jobs.push({
        serviceAddressId,
        subscriptionId,
        scheduledDate: curbIn.toUTC().toJSDate(),
        type: "CURB_IN"
      });
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
          schedule: true,
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

    const schedule = subscription.serviceAddress.schedule;
    if (!schedule) {
      continue;
    }

    const applicableHolidays = holidays.filter(
      (holiday: any) => holiday.municipality.toLowerCase() === subscription.serviceAddress.city.toLowerCase()
    );

    const jobs = calculateJobsForAddress(
      subscription.id,
      subscription.serviceAddress.id,
      subscription.serviceAddress.timezone,
      schedule,
      subscription.serviceAddress.holds,
      applicableHolidays,
      lookahead,
      now,
      subscription.serviceAddress.pickupsPerWeek ?? 1,
      subscription.serviceAddress.rollIn ?? true
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
          status: "SCHEDULED"
        },
        update: {}
      });
      created += 1;
    }
  }

  return { created };
}
