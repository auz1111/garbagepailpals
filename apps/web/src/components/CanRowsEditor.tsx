import type { CanType, ScheduleCan } from "@gpp/shared";
import { formatUsd, scheduleCanMonthlyCents } from "@gpp/shared";

export const CAN_TYPES_ORDER: CanType[] = ["TRASH", "RECYCLING", "YARD", "GLASS"];
export const CAN_LABELS: Record<CanType, string> = {
  TRASH: "Trash",
  RECYCLING: "Recycling",
  YARD: "Yard debris",
  GLASS: "Glass"
};

// Compact, human-readable list of the cans at a stop, e.g. "2 Trash · 1 Recycling".
// Returns "" for an empty list so callers can fall back to a plain count.
export function formatCans(cans: ScheduleCan[]): string {
  return [...cans]
    .sort((a, b) => CAN_TYPES_ORDER.indexOf(a.type) - CAN_TYPES_ORDER.indexOf(b.type))
    .map((c) => `${c.count} ${CAN_LABELS[c.type]}`)
    .join(" · ");
}

// Edit the cans a pickup day services: each has a type, its own cadence, and a
// quantity. Used by the customer + admin schedule editors and the add-location
// wizard so they all share one shape.
export function CanRowsEditor({
  cans,
  onChange
}: {
  cans: ScheduleCan[];
  onChange: (cans: ScheduleCan[]) => void;
}): JSX.Element {
  const used = new Set(cans.map((c) => c.type));
  const firstFree = CAN_TYPES_ORDER.find((t) => !used.has(t));

  const update = (i: number, patch: Partial<ScheduleCan>): void =>
    onChange(cans.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const remove = (i: number): void => onChange(cans.filter((_, idx) => idx !== i));
  const add = (): void => {
    if (firstFree) onChange([...cans, { type: firstFree, cadence: "WEEKLY", count: 1 }]);
  };

  return (
    <div className="can-rows">
      {cans.map((can, i) => (
        <div className="can-row" key={i}>
          <label>
            Can
            <select value={can.type} onChange={(e) => update(i, { type: e.target.value as CanType })}>
              {CAN_TYPES_ORDER.map((t) => (
                <option key={t} value={t} disabled={t !== can.type && used.has(t)}>
                  {CAN_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Cadence
            <select
              value={can.cadence}
              onChange={(e) => update(i, { cadence: e.target.value as "WEEKLY" | "BIWEEKLY" })}
            >
              <option value="WEEKLY">Every week</option>
              <option value="BIWEEKLY">Every 2 weeks</option>
            </select>
          </label>
          <label>
            Qty
            <input
              type="number"
              min={1}
              max={20}
              value={can.count}
              onChange={(e) =>
                update(i, { count: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })
              }
            />
          </label>
          <span className="can-row-price">
            {formatUsd(scheduleCanMonthlyCents(can))}/mo
          </span>
          {cans.length > 1 ? (
            <button type="button" className="link-button can-row-remove" onClick={() => remove(i)}>
              Remove
            </button>
          ) : null}
        </div>
      ))}
      {firstFree ? (
        <button type="button" className="ghost-btn" onClick={add}>
          + Add can
        </button>
      ) : null}
    </div>
  );
}
