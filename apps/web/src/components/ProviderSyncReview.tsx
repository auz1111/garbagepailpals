import { useState } from "react";
import type { CanType, PickupDayInput, PickupStream, ScheduleCan } from "@gpp/shared";
import { streamToCanTypes } from "../lib/providerCans";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The pickup-day shape both workspaces already have on hand (admin location +
// customer schedule), enough to rebuild a schedule payload.
export type SyncPickup = {
  dayOfWeek: number;
  cans: ScheduleCan[];
  rollIn: boolean;
  petWasteDogs: number;
  biweeklyAnchorDate?: string;
};

type ProviderSyncReviewProps = {
  providerLabel?: string | null;
  streams: PickupStream[];
  pickups: SyncPickup[];
  saving: boolean;
  error?: string | null;
  onApply: (days: PickupDayInput[]) => void;
  onSkip: () => void;
};

// Verify-your-pickups review shown after a location connects to a trash provider.
// Lists each provider collection day (sync an existing pickup, or add a missing
// one at 1 can per collection) plus any pickups the provider doesn't collect.
export function ProviderSyncReview({
  providerLabel,
  streams,
  pickups,
  saving,
  error,
  onApply,
  onSkip
}: ProviderSyncReviewProps): JSX.Element {
  // Distill streams into distinct collection days, with one can per stream (a
  // day that collects garbage + recycling + yard becomes 3 cans).
  const dayMap = new Map<
    number,
    { collections: string[]; weekly: boolean; nextDate?: string; cans: Map<CanType, ScheduleCan> }
  >();
  for (const stream of streams) {
    const entry: {
      collections: string[];
      weekly: boolean;
      nextDate?: string;
      cans: Map<CanType, ScheduleCan>;
    } = dayMap.get(stream.dayOfWeek) ?? { collections: [], weekly: false, cans: new Map() };
    entry.collections.push(stream.label);
    if (stream.cadence === "WEEKLY") entry.weekly = true;
    if (stream.nextDate && (!entry.nextDate || stream.nextDate < entry.nextDate)) {
      entry.nextDate = stream.nextDate;
    }
    // One stream can yield more than one can (e.g. a combined glass/yard stream).
    for (const type of streamToCanTypes(stream)) {
      const existing = entry.cans.get(type);
      if (existing) {
        existing.count += 1;
        if (stream.cadence === "WEEKLY") existing.cadence = "WEEKLY";
      } else {
        entry.cans.set(type, { type, cadence: stream.cadence, count: 1 });
      }
    }
    dayMap.set(stream.dayOfWeek, entry);
  }
  const providerDays = [...dayMap.entries()]
    .map(([weekday, e]) => ({
      weekday,
      collections: e.collections,
      cadence: (e.weekly ? "WEEKLY" : "BIWEEKLY") as "WEEKLY" | "BIWEEKLY",
      nextDate: e.nextDate,
      cans: [...e.cans.values()]
    }))
    .sort((a, b) => a.weekday - b.weekday);
  const providerWeekdays = new Set(providerDays.map((d) => d.weekday));
  const otherPickups = pickups
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !providerWeekdays.has(p.dayOfWeek));

  // Default: every provider collection day selected (sync existing + add missing).
  const [sel, setSel] = useState<Set<string>>(
    () => new Set(providerDays.map((d) => `p${d.weekday}`))
  );
  const toggle = (key: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  const apply = (): void => {
    const mapExisting = (p: SyncPickup) => ({
      dayOfWeek: p.dayOfWeek,
      biweeklyAnchorDate: p.biweeklyAnchorDate,
      cans: p.cans,
      rollIn: p.rollIn,
      petWasteDogs: p.petWasteDogs
    });
    const existingByWeekday = new Map(pickups.map((p) => [p.dayOfWeek, p]));
    const days: PickupDayInput[] = [];
    const handled = new Set<number>();

    for (const pd of providerDays) {
      const selected = sel.has(`p${pd.weekday}`);
      const existing = existingByWeekday.get(pd.weekday);
      if (existing) {
        days.push({
          ...mapExisting(existing),
          // Syncing normalizes cans to the provider's collections that day.
          cans: selected ? pd.cans : existing.cans,
          biweeklyAnchorDate:
            selected && pd.cadence === "BIWEEKLY" ? pd.nextDate : existing.biweeklyAnchorDate,
          providerSynced: selected
        });
        handled.add(pd.weekday);
      } else if (selected) {
        days.push({
          dayOfWeek: pd.weekday,
          biweeklyAnchorDate: pd.cadence === "BIWEEKLY" ? pd.nextDate : undefined,
          cans: pd.cans,
          rollIn: true,
          petWasteDogs: 0,
          providerSynced: true
        });
        handled.add(pd.weekday);
      }
    }
    pickups.forEach((p, i) => {
      if (handled.has(p.dayOfWeek)) return;
      days.push({ ...mapExisting(p), providerSynced: sel.has(`o${i}`) });
    });

    onApply(days);
  };

  return (
    <div className="pickup-suggestion" style={{ marginTop: "0.85rem" }}>
      <p>
        <strong>Connected to {providerLabel ?? "your trash provider"}.</strong> They collect on{" "}
        {providerDays.length} day{providerDays.length === 1 ? "" : "s"}. Checked days follow the
        provider (holiday shifts included); a provider day you don't have yet is added as a new pickup.
      </p>
      {providerDays.map((pd) => {
        const existing = pickups.find((p) => p.dayOfWeek === pd.weekday);
        const key = `p${pd.weekday}`;
        const totalCans = pd.cans.reduce((sum, c) => sum + c.count, 0);
        const cansLabel = `${totalCans} can${totalCans === 1 ? "" : "s"}`;
        return (
          <label key={key} className="checkbox-field">
            <input type="checkbox" checked={sel.has(key)} onChange={() => toggle(key)} />
            <span>
              <strong>{WEEKDAYS[pd.weekday]}</strong>
              <span className="subtext">
                Provider collects: {pd.collections.join(", ")} (
                {pd.cadence === "BIWEEKLY" ? "every 2 weeks" : "weekly"}).{" "}
                {existing ? `Sync your existing pickup · ${cansLabel}.` : `Add a pickup day · ${cansLabel}.`}
              </span>
            </span>
          </label>
        );
      })}
      {otherPickups.length > 0 ? (
        <>
          <p className="subtext" style={{ margin: "0.4rem 0 0.1rem" }}>
            <strong>Your other pickup days</strong> — the provider doesn't collect these:
          </p>
          {otherPickups.map(({ p, i }) => {
            const key = `o${i}`;
            return (
              <label key={key} className="checkbox-field">
                <input type="checkbox" checked={sel.has(key)} onChange={() => toggle(key)} />
                <span>
                  <strong>{WEEKDAYS[p.dayOfWeek]}</strong>
                  <span className="subtext">
                    No provider collection — sync anyway to drop the "Not synced" flag.
                  </span>
                </span>
              </label>
            );
          })}
        </>
      ) : null}
      <div className="button-row">
        <button type="button" className="cta-primary" disabled={saving} onClick={apply}>
          {saving ? "Saving…" : "Apply"}
        </button>
        <button type="button" className="ghost-btn" onClick={onSkip}>
          Skip
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
