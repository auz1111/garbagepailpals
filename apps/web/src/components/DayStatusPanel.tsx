import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { DayStatusIssue, DayStatusProvider } from "@gpp/shared";
import { getDayStatus, refreshDaySchedules } from "../lib/api";

type Scope = { zoneId?: string; neighborhoodId?: string };

const HEADLINE: Record<string, { icon: string; label: string; tone: string }> = {
  ON_TRACK: { icon: "✅", label: "On track", tone: "ok" },
  NEEDS_ATTENTION: { icon: "⚠️", label: "Needs attention", tone: "warn" },
  OFF_SCHEDULE: { icon: "🔴", label: "Off schedule", tone: "bad" }
};

const PROVIDER_STATUS: Record<DayStatusProvider["status"], { label: string; cls: string }> = {
  NORMAL: { label: "Normal", cls: "is-ok" },
  SHIFTED: { label: "Holiday shift", cls: "is-warn" },
  NO_COLLECTION: { label: "No collection", cls: "is-bad" },
  UNKNOWN: { label: "Unknown", cls: "is-unknown" }
};

const ISSUE_TONE: Record<DayStatusIssue["type"], string> = {
  UNASSIGNED: "warn",
  AWAITING_ACCEPTANCE: "warn",
  UNSERVICED: "warn",
  PROVIDER_NO_COLLECTION: "bad",
  PROVIDER_SHIFTED: "warn",
  PROVIDER_UNKNOWN: "warn",
  ROUTED_BUT_SKIPPED: "bad"
};

// "Is today going as planned?" — provider-schedule health + route coverage +
// concrete issues, pinned atop Today's Routes. Scope-aware (area + neighborhood).
export function DayStatusPanel({
  accessToken,
  scope
}: {
  accessToken: string;
  scope: Scope;
}): JSX.Element | null {
  const queryClient = useQueryClient();
  const key = ["day-status", scope.zoneId ?? "", scope.neighborhoodId ?? ""];
  const statusQuery = useQuery({
    queryKey: key,
    queryFn: async () => getDayStatus(accessToken, scope),
    // Reflect live progress without a manual reload.
    refetchInterval: 45_000
  });

  const refresh = useMutation({
    mutationFn: () => refreshDaySchedules(accessToken, scope),
    onSuccess: (data) => queryClient.setQueryData(key, data)
  });

  const data = statusQuery.data;
  if (statusQuery.isLoading && !data) {
    return (
      <article className="panel day-status">
        <p className="subtext">Checking today's status…</p>
      </article>
    );
  }
  if (!data) {
    return null;
  }

  const h = HEADLINE[data.headline] ?? HEADLINE.NEEDS_ATTENTION!;
  const { scheduled, assigned, accepted, serviced, unassigned } = data.coverage;
  const pct = (n: number) => (scheduled > 0 ? Math.round((n / scheduled) * 100) : 0);

  return (
    <article className={`panel day-status is-${h.tone}`}>
      <div className="day-status-head">
        <div className="day-status-headline">
          <span className="day-status-icon" aria-hidden="true">
            {h.icon}
          </span>
          <div>
            <strong>Today: {h.label}</strong>
            <span className="subtext">
              {scheduled} location{scheduled === 1 ? "" : "s"} scheduled ·{" "}
              {serviced}/{scheduled} serviced
            </span>
          </div>
        </div>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
        >
          {refresh.isPending ? "Refreshing…" : "↻ Refresh provider schedules"}
        </button>
      </div>

      {data.providers.length > 0 ? (
        <div className="day-status-providers">
          {data.providers.map((p) => {
            const meta = PROVIDER_STATUS[p.status];
            // "__unconfirmed__" is a synthetic bucket with no provider page.
            const linkable = p.id !== "__unconfirmed__";
            const body = (
              <>
                <strong>{p.label}</strong>
                <span>
                  {meta.label}
                  {p.status !== "NORMAL" && p.affected > 0 ? ` · ${p.affected}` : ""}
                </span>
              </>
            );
            return linkable ? (
              <Link
                key={p.id}
                className={`provider-pill ${meta.cls}`}
                to={`/admin/hauler-coverage#provider-${p.id}`}
                title={`View ${p.label} on Trash Providers`}
              >
                {body}
              </Link>
            ) : (
              <span key={p.id} className={`provider-pill ${meta.cls}`}>
                {body}
              </span>
            );
          })}
        </div>
      ) : null}

      <div className="day-status-coverage">
        <div className="coverage-bar" role="img" aria-label={`${serviced} of ${scheduled} serviced`}>
          <span className="coverage-fill is-serviced" style={{ width: `${pct(serviced)}%` }} />
          <span className="coverage-fill is-accepted" style={{ width: `${pct(accepted - serviced)}%` }} />
          <span
            className="coverage-fill is-assigned"
            style={{ width: `${pct(assigned - accepted)}%` }}
          />
        </div>
        <div className="coverage-legend">
          <span>Assigned {assigned}/{scheduled}</span>
          <span>Accepted {accepted}</span>
          <span>Serviced {serviced}</span>
          {unassigned > 0 ? <span className="is-warn">Unassigned {unassigned}</span> : null}
        </div>
      </div>

      {data.issues.length > 0 ? (
        <ul className="day-status-issues">
          {data.issues.slice(0, 12).map((issue, i) => {
            const body = (
              <>
                <span className={`issue-dot is-${ISSUE_TONE[issue.type]}`} aria-hidden="true" />
                <span>{issue.detail}</span>
              </>
            );
            return (
              <li key={i} className="day-status-issue">
                {issue.addressId ? (
                  <a href={`#address-${issue.addressId}`}>{body}</a>
                ) : (
                  <span className="day-status-issue-static">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="subtext">Everything scheduled today is assigned, accepted, and on track.</p>
      )}
      {refresh.isError ? <p className="error">Couldn't refresh provider schedules.</p> : null}
    </article>
  );
}
