import { DateTime } from "luxon";
import type { HaulerUpcoming } from "@gpp/shared";

// JS-style weekday index (0=Sun..6=Sat) from a Luxon DateTime.
export function weekdayIndexFromLuxon(dt: DateTime): number {
  return dt.weekday % 7;
}

// The actual collection dates for one provider stream that normally lands on a
// given weekday: date per (Monday-)week, plus the covered window.
export type StreamSchedule = {
  byWeek: Map<number, DateTime>;
  from: DateTime;
  to: DateTime;
};

// The provider collects several streams (garbage/recycling/yard) on different
// weekdays. Distill the cached concrete dates into a map keyed by each stream's
// NORMAL weekday, so a synced pickup day can be reconciled against the provider
// collection that falls on the same weekday.
export function parseHaulerStreams(
  upcoming: HaulerUpcoming,
  zone: string
): Map<number, StreamSchedule> {
  const from = DateTime.fromISO(upcoming.from, { zone }).startOf("day");
  const to = DateTime.fromISO(upcoming.to, { zone }).endOf("day");

  const byKind = new Map<string, DateTime[]>();
  for (const pickup of upcoming.pickups) {
    const d = DateTime.fromISO(pickup.date, { zone }).startOf("day");
    if (!d.isValid) {
      continue;
    }
    const list = byKind.get(pickup.kind) ?? [];
    list.push(d);
    byKind.set(pickup.kind, list);
  }

  const byWeekday = new Map<number, StreamSchedule>();
  for (const dates of byKind.values()) {
    if (dates.length === 0) {
      continue;
    }
    // Normal weekday = the mode (holiday-shifted dates are the minority).
    const counts = new Map<number, number>();
    for (const d of dates) {
      const w = weekdayIndexFromLuxon(d);
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    let normalWeekday = weekdayIndexFromLuxon(dates[0]!);
    let best = -1;
    for (const [w, c] of counts) {
      if (c > best) {
        best = c;
        normalWeekday = w;
      }
    }
    // Earliest actual date per week (handles a holiday moving a date within its week).
    const target = byWeekday.get(normalWeekday) ?? { byWeek: new Map<number, DateTime>(), from, to };
    for (const d of dates) {
      const wk = d.startOf("week").toMillis();
      const existing = target.byWeek.get(wk);
      if (!existing || d < existing) {
        target.byWeek.set(wk, d);
      }
    }
    byWeekday.set(normalWeekday, target);
  }
  return byWeekday;
}

export type ProviderDayStatus = "NORMAL" | "SHIFTED" | "NO_COLLECTION" | "OUT_OF_WINDOW";

// For a pickup stream that normally lands on `weekday`, what does the provider
// actually do the week that contains `targetDay`? Used to reconcile a synced
// pickup against provider holiday shifts/cancellations.
//   NORMAL         — the provider collects on targetDay as expected
//   SHIFTED        — the provider collects that week, but on a different day
//   NO_COLLECTION  — the provider skips that week (holiday)
//   OUT_OF_WINDOW  — no stream for that weekday, or targetDay is outside our data
export function providerStatusForDay(
  streams: Map<number, StreamSchedule>,
  weekday: number,
  targetDay: DateTime
): { status: ProviderDayStatus; actualDate: DateTime | null } {
  const stream = streams.get(weekday);
  if (!stream) {
    return { status: "OUT_OF_WINDOW", actualDate: null };
  }
  if (targetDay < stream.from || targetDay > stream.to) {
    return { status: "OUT_OF_WINDOW", actualDate: null };
  }
  const actual = stream.byWeek.get(targetDay.startOf("week").toMillis()) ?? null;
  if (!actual) {
    return { status: "NO_COLLECTION", actualDate: null };
  }
  return {
    status: actual.hasSame(targetDay, "day") ? "NORMAL" : "SHIFTED",
    actualDate: actual
  };
}
