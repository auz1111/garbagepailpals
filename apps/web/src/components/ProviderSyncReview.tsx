import { useState } from "react";
import type { PickupDayInput, PickupStream } from "@gpp/shared";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The pickup-day shape both workspaces already have on hand (admin location +
// customer schedule), enough to rebuild a schedule payload.
export type SyncPickup = {
  dayOfWeek: number;
  cadence: "WEEKLY" | "BIWEEKLY";
  canCount: number;
  rollIn: boolean;
  glassRecycling: boolean;
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
  // Distill streams into distinct collection days.
  const dayMap = new Map<number, { collections: string[]; weekly: boolean; nextDate?: string }>();
  for (const stream of streams) {
    const entry = dayMap.get(stream.dayOfWeek) ?? { collections: [], weekly: false };
    entry.collections.push(stream.label);
    if (stream.cadence === "WEEKLY") entry.weekly = true;
    if (stream.nextDate && (!entry.nextDate || stream.nextDate < entry.nextDate)) {
      entry.nextDate = stream.nextDate;
    }
    dayMap.set(stream.dayOfWeek, entry);
  }
  const providerDays = [...dayMap.entries()]
    .map(([weekday, e]) => ({
      weekday,
      collections: e.collections,
      cadence: (e.weekly ? "WEEKLY" : "BIWEEKLY") as "WEEKLY" | "BIWEEKLY",
      nextDate: e.nextDate,
      cans: Math.max(1, e.collections.length)
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
      cadence: p.cadence,
      biweeklyAnchorDate: p.biweeklyAnchorDate,
      canCount: p.canCount,
      rollIn: p.rollIn,
      glassRecycling: p.glassRecycling,
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
          canCount: selected ? pd.cans : existing.canCount,
          providerSynced: selected
        });
        handled.add(pd.weekday);
      } else if (selected) {
        days.push({
          dayOfWeek: pd.weekday,
          cadence: pd.cadence,
          biweeklyAnchorDate: pd.cadence === "BIWEEKLY" ? pd.nextDate : undefined,
          canCount: pd.cans,
          rollIn: true,
          glassRecycling: false,
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
        const cansLabel = `${pd.cans} can${pd.cans === 1 ? "" : "s"}`;
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
