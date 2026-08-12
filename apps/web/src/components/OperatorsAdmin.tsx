import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminOperator, TimeOffStatus } from "@gpp/shared";
import { getAdminOperators, setOperatorTimeOff } from "../lib/api";

type OperatorsAdminProps = {
  accessToken: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

// Build N day keys (YYYY-MM-DD) starting from a date key, timezone-safe.
function windowDays(fromKey: string, count: number): string[] {
  const base = new Date(`${fromKey}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(base.getTime() + i * 86_400_000);
    return d.toISOString().slice(0, 10);
  });
}

function labelFor(dateKey: string): { dow: string; day: string } {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  return {
    dow: d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" }),
    day: d.toLocaleDateString(undefined, { day: "numeric", timeZone: "UTC" })
  };
}

export function OperatorsAdmin({ accessToken }: OperatorsAdminProps): JSX.Element {
  const queryClient = useQueryClient();
  const [threshold, setThreshold] = useState(2);

  const operatorsQuery = useQuery({
    queryKey: ["admin-operators"],
    queryFn: async () => getAdminOperators(accessToken)
  });
  const data = operatorsQuery.data;
  const operators = data?.operators ?? [];
  const days = data ? windowDays(data.from, 30) : [];

  const mutation = useMutation({
    mutationFn: ({
      operatorId,
      date,
      status
    }: {
      operatorId: string;
      date: string;
      status: TimeOffStatus | null;
    }) => setOperatorTimeOff(operatorId, { date, status: status as "APPROVED" | "DENIED" | null }, accessToken),
    onSuccess: (result) => {
      queryClient.setQueryData(["admin-operators"], result);
    }
  });

  // Map for quick lookup: `${operatorId}:${date}` -> status.
  const statusMap = new Map<string, TimeOffStatus>();
  for (const op of operators) {
    for (const d of op.days) statusMap.set(`${op.id}:${d.date}`, d.status);
  }
  const statusFor = (opId: string, date: string): TimeOffStatus | undefined =>
    statusMap.get(`${opId}:${date}`);

  // Pending requests across all operators, for the approval queue.
  const pending: Array<{ operator: AdminOperator; date: string }> = [];
  for (const op of operators) {
    for (const d of op.days) {
      if (d.status === "PENDING") pending.push({ operator: op, date: d.date });
    }
  }
  pending.sort((a, b) => a.date.localeCompare(b.date));

  // Coverage: available operators per day (everyone minus APPROVED-off).
  const availableOn = (date: string): number =>
    operators.filter((op) => statusFor(op.id, date) !== "APPROVED").length;

  function cellClass(status: TimeOffStatus | undefined): string {
    if (status === "APPROVED") return "ops-cal-day is-approved";
    if (status === "PENDING") return "ops-cal-day is-pending";
    if (status === "DENIED") return "ops-cal-day is-denied";
    return "ops-cal-day is-available";
  }

  // Grid click toggles a direct (admin) day off: available/denied/pending -> APPROVED off; approved -> clear.
  function onCellClick(opId: string, date: string, status: TimeOffStatus | undefined): void {
    mutation.mutate({ operatorId: opId, date, status: status === "APPROVED" ? null : "APPROVED" });
  }

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <h2>Operators</h2>
        <p className="subtext">
          Review availability, approve time-off requests, and spot coverage gaps over the next 30
          days.
        </p>
      </div>

      <article className="panel">
        <div className="panel-head-row">
          <h3>
            Time-off requests
            {pending.length > 0 ? <span className="count-badge">{pending.length}</span> : null}
          </h3>
        </div>
        {operatorsQuery.isLoading ? (
          <p className="subtext">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="subtext">No pending time-off requests.</p>
        ) : (
          <ul className="request-list">
            {pending.map(({ operator, date }) => (
              <li className="request-row" key={`${operator.id}:${date}`}>
                <div>
                  <strong>{operator.name}</strong>
                  <span className="admin-table-sub">
                    Requested off{" "}
                    {new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC"
                    })}
                  </span>
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    className="cta-primary"
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation.mutate({ operatorId: operator.id, date, status: "APPROVED" })
                    }
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation.mutate({ operatorId: operator.id, date, status: "DENIED" })
                    }
                  >
                    Deny
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="panel">
        <div className="panel-head-row">
          <h3>Coverage</h3>
          <label className="coverage-threshold">
            Flag days under
            <input
              type="number"
              min={1}
              max={Math.max(1, operators.length)}
              value={threshold}
              onChange={(event) => setThreshold(Math.max(1, Number(event.target.value) || 1))}
            />
            operators
          </label>
        </div>
        <p className="subtext">
          Available operators each day (everyone minus approved time off). Highlighted days fall
          below your threshold.
        </p>
        {days.length === 0 ? (
          <p className="subtext">Loading…</p>
        ) : (
          <div className="coverage-strip">
            {days.map((date) => {
              const count = availableOn(date);
              const gap = count < threshold;
              const { dow, day } = labelFor(date);
              return (
                <div key={date} className={`coverage-chip${gap ? " is-gap" : ""}`} title={`${count} available`}>
                  <span className="coverage-dow">{dow}</span>
                  <span className="coverage-day">{day}</span>
                  <span className="coverage-count">{count}</span>
                </div>
              );
            })}
          </div>
        )}
      </article>

      <article className="panel">
        <div className="panel-head-row">
          <h3>Operator availability</h3>
        </div>
        <p className="subtext">
          Tap a day to mark an operator off (approved) or clear it. Gold = requested, red = off.
        </p>
        {operatorsQuery.isLoading ? (
          <p className="subtext">Loading…</p>
        ) : operators.length === 0 ? (
          <p className="subtext">No operators yet.</p>
        ) : (
          <div className="ops-operators">
            {operators.map((op) => (
              <div className="ops-operator" key={op.id}>
                <div className="ops-operator-name" title={op.email}>
                  {op.name}
                </div>
                <div className="ops-cal">
                  {days.map((date) => {
                    const status = statusFor(op.id, date);
                    const { dow, day } = labelFor(date);
                    return (
                      <button
                        type="button"
                        key={date}
                        className={cellClass(status)}
                        disabled={mutation.isPending}
                        title={`${op.name} · ${date}${status ? ` · ${status.toLowerCase()}` : " · available"}`}
                        onClick={() => onCellClick(op.id, date, status)}
                      >
                        <span className="ops-cal-dow">{dow}</span>
                        <span className="ops-cal-num">{day}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        {operators.length > 0 ? (
          <div className="map-legend ops-legend">
            <span>
              <span
                className="legend-dot"
                style={{ background: "#d9f0df", border: "1px solid #8fce9f" }}
              />{" "}
              Available
            </span>
            <span>
              <span className="legend-dot" style={{ background: "var(--gold)" }} /> Requested off
            </span>
            <span>
              <span className="legend-dot" style={{ background: "var(--danger)" }} /> Off (approved)
            </span>
          </div>
        ) : null}
        {operatorsQuery.isError ? (
          <p className="error">{getErrorMessage(operatorsQuery.error)}</p>
        ) : null}
        {mutation.isError ? <p className="error">{getErrorMessage(mutation.error)}</p> : null}
      </article>
    </div>
  );
}
