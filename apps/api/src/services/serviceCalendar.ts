import { prisma } from "@gpp/db";
import { env } from "../lib/env";
import { getUpcomingForAddress } from "./haulerSchedule";
import { schedulesFromServices } from "./locationServices";
import { calculateJobsForAddress } from "./scheduler";

// A single serviceable occurrence (curb-out or curb-in) on a concrete date,
// computed on demand from the customer's schedule + hauler data. Nothing here is
// persisted — this is the read model that replaces pre-generated ServiceJob rows.
export type CalendarOccurrence = {
  serviceAddressId: string;
  subscriptionId: string;
  scheduledDate: Date;
  type: "CURB_OUT" | "CURB_IN";
  status: "SCHEDULED" | "SKIPPED";
  shiftedFromDate: Date | null;
  shiftReason: string | null;
};

// Prisma stores lat/lng as Decimal; normalize to a plain number for the hauler
// lookup (Republic's holiday endpoint needs coordinates).
function toNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value;
  const maybe = value as { toNumber?: () => number };
  if (typeof maybe.toNumber === "function") return maybe.toNumber();
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// A deterministic, stable identifier for a computed occurrence. It has no DB row,
// but the client still wants a unique key per item (React lists, dedupe, etc.).
export function occurrenceId(o: {
  serviceAddressId: string;
  type: string;
  scheduledDate: Date;
}): string {
  return `${o.serviceAddressId}:${o.type}:${o.scheduledDate.toISOString()}`;
}

// Compute every serviceable occurrence in [now, through] for the given scope,
// straight from ServiceSchedule + hauler data. This is the source of truth for
// the customer/admin calendar — no scheduler, no stored jobs.
export async function projectServiceCalendar(
  now: Date,
  options: { userId?: string; throughDate?: Date } = {}
): Promise<CalendarOccurrence[]> {
  const through =
    options.throughDate ?? new Date(now.getTime() + env.SCHEDULER_LOOKAHEAD_DAYS * 864e5);
  // calculateJobsForAddress walks whole days from start-of-today; size the window
  // generously (+1) so an occurrence on the final day isn't clipped.
  const lookaheadDays = Math.max(1, Math.ceil((through.getTime() - now.getTime()) / 864e5) + 1);

  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "TRIALING"] },
      // A location must be admin-approved before any pickups show for it.
      serviceAddress: { isActive: true, serviceApprovedAt: { not: null } },
      ...(options.userId ? { userId: options.userId } : {})
    },
    include: {
      serviceAddress: {
        include: { locationServices: { include: { days: true } }, holds: true }
      }
    }
  });

  const holidays = await prisma.holidayCalendar.findMany({
    where: { date: { gte: now, lte: through } }
  });

  const occurrences: CalendarOccurrence[] = [];

  for (const subscription of subscriptions) {
    const address = subscription.serviceAddress;
    const schedules = schedulesFromServices(address.id, address.locationServices, address.updatedAt);
    if (schedules.length === 0) continue;

    const applicableHolidays = holidays.filter(
      (h) => h.municipality.toLowerCase() === address.city.toLowerCase()
    );

    // Hauler dates are cached; a lookup failure falls back to the weekday rule.
    const haulerUpcoming = await getUpcomingForAddress(
      { line1: address.line1, city: address.city, state: address.state, postalCode: address.postalCode },
      through,
      { lat: toNumber(address.lat), lng: toNumber(address.lng) }
    ).catch(() => null);

    const jobs = calculateJobsForAddress(
      subscription.id,
      address.id,
      address.timezone,
      schedules as any,
      address.holds as any,
      applicableHolidays as any,
      lookaheadDays,
      now,
      haulerUpcoming
    );

    occurrences.push(...jobs);
  }

  return occurrences
    .filter((o) => o.scheduledDate >= now && o.scheduledDate <= through)
    .sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime());
}
