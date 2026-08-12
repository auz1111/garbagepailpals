import { DateTime, IANAZone } from "luxon";
import tzlookup from "tz-lookup";
import { env } from "./env";

// Everything in the routing/scheduling engine reasons about a "service day" in a
// real IANA timezone, never the server's local clock — otherwise the operating
// day rolls over at the wrong moment on a UTC host. These helpers centralize
// that math.

// The business/operating zone used to key a service day when a more specific
// per-location zone isn't available (single-area default).
export function defaultOperatingZone(): string {
  return env.SERVICE_DEFAULT_TIMEZONE;
}

export function isValidZone(zone: string): boolean {
  return IANAZone.isValidZone(zone);
}

// Resolve an IANA timezone from coordinates (offline lookup). Falls back to the
// default operating zone if the lookup fails or yields an invalid zone.
export function timezoneForCoords(lat: number, lng: number): string {
  try {
    const zone = tzlookup(lat, lng);
    if (zone && isValidZone(zone)) {
      return zone;
    }
  } catch {
    // tz-lookup throws on out-of-range coordinates — fall through to the default.
  }
  return defaultOperatingZone();
}

// A given zone, or the default when the candidate is missing/invalid.
export function resolveZone(candidate: string | null | undefined): string {
  return candidate && isValidZone(candidate) ? candidate : defaultOperatingZone();
}

// A date-only key (UTC midnight) for the calendar day `now` falls on in `zone`.
// DailyRoute.serviceDate is stored this way so it's stable regardless of the
// server's clock.
export function serviceDateForZone(now: Date, zone: string): Date {
  const local = DateTime.fromJSDate(now, { zone });
  return new Date(Date.UTC(local.year, local.month - 1, local.day));
}

// Weekday (0=Sun..6=Sat, matching JS getDay and ServiceSchedule.pickupDayOfWeek)
// of `now` shifted by `offsetDays`, evaluated in `zone`.
export function weekdayInZone(now: Date, zone: string, offsetDays: number): number {
  return DateTime.fromJSDate(now, { zone }).plus({ days: offsetDays }).weekday % 7;
}

// The calendar day (start-of-day) of `now` shifted by `offsetDays`, in `zone` —
// used for biweekly anchor comparisons.
export function zonedDay(now: Date, zone: string, offsetDays: number): DateTime {
  return DateTime.fromJSDate(now, { zone }).plus({ days: offsetDays }).startOf("day");
}

// Whether `day` lands on an "on" week for a biweekly schedule anchored at
// `anchorDate` (even number of whole weeks since the anchor).
export function biweeklyMatchesZoned(anchorDate: Date | null, day: DateTime): boolean {
  if (!anchorDate) {
    return false;
  }
  const anchor = DateTime.fromJSDate(anchorDate).startOf("day");
  const diffWeeks = Math.floor(day.diff(anchor, "days").days / 7);
  return diffWeeks % 2 === 0;
}
