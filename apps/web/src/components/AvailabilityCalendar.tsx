import { useEffect, useMemo, useState } from "react";

type AvailabilityCalendarProps = {
  dates: string[];
  onSave: (dates: string[]) => void;
  saving: boolean;
  loading?: boolean;
  saved?: boolean;
};

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function AvailabilityCalendar({
  dates,
  onSave,
  saving,
  loading,
  saved
}: AvailabilityCalendarProps): JSX.Element {
  const next30Days = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + i);
        return d;
      }),
    []
  );

  const [selected, setSelected] = useState<Set<string>>(new Set(dates));
  useEffect(() => {
    setSelected(new Set(dates));
  }, [dates]);

  const savedSet = new Set(dates);
  const dirty =
    selected.size !== savedSet.size || [...selected].some((d) => !savedSet.has(d));

  function toggle(key: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (loading) {
    return <p className="subtext">Loading availability…</p>;
  }

  return (
    <>
      <div className="availability-grid">
        {next30Days.map((d) => {
          const key = dayKey(d);
          const on = selected.has(key);
          return (
            <button
              type="button"
              key={key}
              className={`availability-day${on ? " is-on" : ""}`}
              onClick={() => toggle(key)}
            >
              <span className="availability-dow">
                {d.toLocaleDateString(undefined, { weekday: "short" })}
              </span>
              <span className="availability-num">{d.getDate()}</span>
              <span className="availability-mon">
                {d.toLocaleDateString(undefined, { month: "short" })}
              </span>
            </button>
          );
        })}
      </div>
      <div className="detail-save-row">
        {dirty ? (
          <button
            type="button"
            className="add-day-btn"
            onClick={() => onSave([...selected].sort())}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save availability"}
          </button>
        ) : saved ? (
          <span className="success-inline">Availability saved.</span>
        ) : null}
      </div>
    </>
  );
}
