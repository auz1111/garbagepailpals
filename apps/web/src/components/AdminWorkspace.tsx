import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";
import type { AdminIncident, CurrentUser, Role } from "@gpp/shared";
import { formatUsd } from "@gpp/shared";
import {
  acknowledgeAdminIncident,
  assignAdminIncident,
  getAdminUsers,
  getAdminDashboardMetrics,
  getAdminIncidents,
  getAdminRuntimeMetrics,
  reopenAdminIncident,
  resolveAdminIncident
} from "../lib/api";

type AdminWorkspaceProps = {
  user: CurrentUser;
  accessToken: string;
};

export const ADMIN_NAV = [
  { to: "/admin", label: "Dashboard", icon: "📊", end: true },
  { to: "/admin/users", label: "Users", icon: "👥" }
] as const;

const ROLE_LABELS: Record<Role, string> = {
  CUSTOMER: "Customer",
  OPERATOR: "Operator",
  ADMIN: "Admin"
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function AdminWorkspace({ user, accessToken }: AdminWorkspaceProps): JSX.Element {
  const queryClient = useQueryClient();
  const [stateFilter, setStateFilter] = useState<"ALL" | "OPEN" | "ACKNOWLEDGED" | "RESOLVED">("ALL");
  const [sourceFilter, setSourceFilter] = useState<"ALL" | "JOB" | "NOTIFICATION" | "WEBHOOK">("ALL");
  const [severityFilter, setSeverityFilter] = useState<"ALL" | "WARN" | "CRITICAL">("ALL");
  const [ownerFilter, setOwnerFilter] = useState<"ALL" | "MINE" | "UNASSIGNED">("ALL");

  const metricsQuery = useQuery({
    queryKey: ["admin-metrics"],
    queryFn: async () => getAdminDashboardMetrics(accessToken)
  });

  const runtimeMetricsQuery = useQuery({
    queryKey: ["admin-runtime-metrics"],
    queryFn: async () => getAdminRuntimeMetrics(accessToken)
  });

  const incidentsQuery = useQuery({
    queryKey: ["admin-incidents", stateFilter, sourceFilter, severityFilter, ownerFilter, user.id],
    queryFn: async () =>
      getAdminIncidents(accessToken, {
        state: stateFilter === "ALL" ? undefined : stateFilter,
        source: sourceFilter === "ALL" ? undefined : sourceFilter,
        severity: severityFilter === "ALL" ? undefined : severityFilter,
        ownerUserId:
          ownerFilter === "MINE"
            ? user.id
            : ownerFilter === "UNASSIGNED"
              ? "__unassigned"
              : undefined
      })
  });

  const [userRoleFilter, setUserRoleFilter] = useState<"ALL" | Role>("ALL");
  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => getAdminUsers(accessToken)
  });

  const metrics = metricsQuery.data;
  const runtimeMetrics = runtimeMetricsQuery.data;
  const incidents = incidentsQuery.data;

  const acknowledgeMutation = useMutation({
    mutationFn: async (incidentId: string) => acknowledgeAdminIncident(incidentId, {}, accessToken),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-incidents"] });
    }
  });

  const assignMutation = useMutation({
    mutationFn: async (incidentId: string) => assignAdminIncident(incidentId, { ownerUserId: user.id }, accessToken),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-incidents"] });
    }
  });

  const resolveMutation = useMutation({
    mutationFn: async (incidentId: string) => resolveAdminIncident(incidentId, {}, accessToken),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-incidents"] });
    }
  });

  const reopenMutation = useMutation({
    mutationFn: async (incidentId: string) => reopenAdminIncident(incidentId, {}, accessToken),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-incidents"] });
    }
  });

  const incidentStats = useMemo(() => {
    const list = incidents?.incidents ?? [];
    return {
      open: list.filter((item) => item.state === "OPEN").length,
      acknowledged: list.filter((item) => item.state === "ACKNOWLEDGED").length,
      resolved: list.filter((item) => item.state === "RESOLVED").length,
      breached: list.filter((item) => item.breachedSla).length
    };
  }, [incidents]);

  const orderedIncidents = useMemo(() => {
    const list = [...(incidents?.incidents ?? [])];

    const stateWeight = (state: AdminIncident["state"]): number => {
      if (state === "OPEN") {
        return 0;
      }

      if (state === "ACKNOWLEDGED") {
        return 1;
      }

      return 2;
    };

    const severityWeight = (severity: AdminIncident["severity"]): number => {
      return severity === "CRITICAL" ? 0 : 1;
    };

    return list.sort((a, b) => {
      if (stateWeight(a.state) !== stateWeight(b.state)) {
        return stateWeight(a.state) - stateWeight(b.state);
      }

      if (severityWeight(a.severity) !== severityWeight(b.severity)) {
        return severityWeight(a.severity) - severityWeight(b.severity);
      }

      return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
    });
  }, [incidents]);

  function renderUsers(): JSX.Element {
    const all = usersQuery.data?.users ?? [];
    const rows = userRoleFilter === "ALL" ? all : all.filter((u) => u.role === userRoleFilter);
    const counts = all.reduce<Record<string, number>>((acc, u) => {
      acc[u.role] = (acc[u.role] ?? 0) + 1;
      return acc;
    }, {});
    return (
      <div className="dash-page">
        <div className="dash-page-head">
          <h2>Users</h2>
          <p className="subtext">
            {all.length} total · {counts.CUSTOMER ?? 0} customers · {counts.OPERATOR ?? 0} operators ·{" "}
            {counts.ADMIN ?? 0} admins
          </p>
        </div>
        <article className="panel">
          <label className="field-single">
            Filter by role
            <select
              value={userRoleFilter}
              onChange={(event) => setUserRoleFilter(event.target.value as "ALL" | Role)}
            >
              <option value="ALL">All roles</option>
              <option value="CUSTOMER">Customers</option>
              <option value="OPERATOR">Operators</option>
              <option value="ADMIN">Admins</option>
            </select>
          </label>

          {usersQuery.isLoading ? (
            <p className="subtext">Loading users…</p>
          ) : usersQuery.isError ? (
            <p className="error">{getErrorMessage(usersQuery.error)}</p>
          ) : rows.length === 0 ? (
            <p className="subtext">No users match this filter.</p>
          ) : (
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Locations</th>
                    <th>Plan</th>
                    <th>Monthly</th>
                    <th>Area</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((entry) => (
                    <tr key={entry.id}>
                      <td className="admin-cell-user">
                        <strong>{entry.name}</strong>
                        <span className="admin-table-sub">{entry.email}</span>
                      </td>
                      <td data-label="Role">{ROLE_LABELS[entry.role]}</td>
                      <td data-label="Locations">
                        {entry.role === "CUSTOMER" ? entry.addressCount : "—"}
                      </td>
                      <td data-label="Plan">
                        {entry.role === "CUSTOMER" ? (
                          <span
                            className={`coverage-badge ${
                              entry.activeSubscription ? "covered" : "uncovered"
                            }`}
                          >
                            {entry.activeSubscription ? "Active" : "None"}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td data-label="Monthly">
                        {entry.role === "CUSTOMER" ? `${formatUsd(entry.monthlyCents)}/mo` : "—"}
                      </td>
                      <td data-label="Area">{entry.requestedServiceArea ?? "—"}</td>
                      <td data-label="Joined">{new Date(entry.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>
    );
  }

  function renderDashboard(): JSX.Element {
    return (
      <>
        <h2>Admin Dashboard</h2>
      <p className="subtext">Signed in as {user.name}. Metrics refresh on page load.</p>

      {!metrics ? (
        <p className="subtext">{metricsQuery.isLoading ? "Loading metrics..." : "No metrics available yet."}</p>
      ) : (
        <div className="panel-grid">
          <article className="panel">
            <h3>Users</h3>
            <ul className="meta-list compact">
              <li>Total: {metrics.users.total}</li>
              <li>Customers: {metrics.users.customers}</li>
              <li>Operators: {metrics.users.operators}</li>
              <li>Admins: {metrics.users.admins}</li>
            </ul>
          </article>

          <article className="panel">
            <h3>Service</h3>
            <ul className="meta-list compact">
              <li>Active addresses: {metrics.service.addresses}</li>
              <li>Active subscriptions: {metrics.service.activeSubscriptions}</li>
              <li>Active entitlements: {metrics.service.activeEntitlements}</li>
            </ul>
          </article>

          <article className="panel">
            <h3>Jobs</h3>
            <ul className="meta-list compact">
              <li>Scheduled next 7 days: {metrics.jobs.scheduledNext7Days}</li>
              <li>Completed last 7 days: {metrics.jobs.completedLast7Days}</li>
              <li>Failed last 7 days: {metrics.jobs.failedLast7Days}</li>
            </ul>
          </article>

          <article className="panel">
            <h3>Webhooks (24h)</h3>
            <ul className="meta-list compact">
              <li>Stripe events: {metrics.webhooks.stripeLast24h}</li>
              <li>PayPal events: {metrics.webhooks.paypalLast24h}</li>
            </ul>
          </article>

          <article className="panel">
            <h3>Notifications (24h)</h3>
            <ul className="meta-list compact">
              <li>Reminders sent: {metrics.notifications.remindersSentLast24h}</li>
              <li>Reminders failed: {metrics.notifications.remindersFailedLast24h}</li>
              <li>Overdue sent: {metrics.notifications.overdueSentLast24h}</li>
              <li>Overdue failed: {metrics.notifications.overdueFailedLast24h}</li>
            </ul>
          </article>
        </div>
      )}

      {metricsQuery.error ? <p className="error">{getErrorMessage(metricsQuery.error)}</p> : null}

      {runtimeMetrics ? (
        <div className="panel-grid" style={{ marginTop: "1rem" }}>
          <article className="panel">
            <h3>Runtime</h3>
            <ul className="meta-list compact">
              <li>Started: {new Date(runtimeMetrics.runtime.startedAt).toLocaleString()}</li>
              <li>Uptime: {runtimeMetrics.runtime.uptimeSeconds}s</li>
              <li>Notification provider: {runtimeMetrics.notifications.provider}</li>
            </ul>
          </article>

          <article className="panel">
            <h3>Auth Throttle (process lifetime)</h3>
            <ul className="meta-list compact">
              <li>Window: {runtimeMetrics.authRateLimits.windowMs}ms</li>
              <li>Register allowed/blocked: {runtimeMetrics.authRateLimits.register.allowed}/{runtimeMetrics.authRateLimits.register.blocked}</li>
              <li>Login allowed/blocked: {runtimeMetrics.authRateLimits.login.allowed}/{runtimeMetrics.authRateLimits.login.blocked}</li>
              <li>Refresh allowed/blocked: {runtimeMetrics.authRateLimits.refresh.allowed}/{runtimeMetrics.authRateLimits.refresh.blocked}</li>
            </ul>
          </article>

          <article className="panel">
            <h3>Notification Retry Config</h3>
            <ul className="meta-list compact">
              <li>Max retries: {runtimeMetrics.notifications.maxRetries}</li>
              <li>Base retry delay: {runtimeMetrics.notifications.retryBaseDelayMs}ms</li>
            </ul>
          </article>
        </div>
      ) : (
        <p className="subtext" style={{ marginTop: "1rem" }}>
          {runtimeMetricsQuery.isLoading ? "Loading runtime metrics..." : "Runtime metrics unavailable."}
        </p>
      )}

      {runtimeMetricsQuery.error ? <p className="error">{getErrorMessage(runtimeMetricsQuery.error)}</p> : null}

      <section style={{ marginTop: "1rem" }}>
        <h3>Incident Feed</h3>
        <div className="panel" style={{ marginBottom: "0.75rem" }}>
          <div className="button-row" style={{ marginBottom: "0.75rem" }}>
            <span>Open: {incidentStats.open}</span>
            <span>Acknowledged: {incidentStats.acknowledged}</span>
            <span>Resolved: {incidentStats.resolved}</span>
            <span>Breached SLA: {incidentStats.breached}</span>
          </div>

          <div className="panel-grid">
            <label>
              State
              <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as typeof stateFilter)}>
                <option value="ALL">All</option>
                <option value="OPEN">Open</option>
                <option value="ACKNOWLEDGED">Acknowledged</option>
                <option value="RESOLVED">Resolved</option>
              </select>
            </label>

            <label>
              Source
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}>
                <option value="ALL">All</option>
                <option value="JOB">Job</option>
                <option value="NOTIFICATION">Notification</option>
                <option value="WEBHOOK">Webhook</option>
              </select>
            </label>

            <label>
              Severity
              <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value as typeof severityFilter)}>
                <option value="ALL">All</option>
                <option value="CRITICAL">Critical</option>
                <option value="WARN">Warn</option>
              </select>
            </label>

            <label>
              Owner
              <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value as typeof ownerFilter)}>
                <option value="ALL">All</option>
                <option value="MINE">Mine</option>
                <option value="UNASSIGNED">Unassigned</option>
              </select>
            </label>
          </div>
        </div>

        {!incidents ? (
          <p className="subtext">{incidentsQuery.isLoading ? "Loading incidents..." : "No incidents loaded."}</p>
        ) : incidents.incidents.length === 0 ? (
          <p className="subtext">No incidents detected in the current lookback windows.</p>
        ) : (
          <div className="panel-grid">
            {orderedIncidents.slice(0, 12).map((incident) => (
              <article className="panel" key={incident.id}>
                <h3>
                  {incident.severity} - {incident.source} - {incident.state}
                </h3>
                <ul className="meta-list compact">
                  <li>{incident.title}</li>
                  <li>{incident.detail}</li>
                  <li>Occurred: {new Date(incident.occurredAt).toLocaleString()}</li>
                  <li>State updated: {new Date(incident.stateUpdatedAt).toLocaleString()}</li>
                  <li>Open minutes: {incident.openMinutes}</li>
                  <li>SLA breached: {incident.breachedSla ? "Yes" : "No"}</li>
                  <li>
                    {incident.entityType}: {incident.entityId}
                  </li>
                  <li>Owner: {incident.ownerUserId ?? "Unassigned"}</li>
                  <li>
                    Acknowledged: {incident.acknowledgedAt ? `${new Date(incident.acknowledgedAt).toLocaleString()} by ${incident.acknowledgedByUserId ?? "unknown"}` : "No"}
                  </li>
                  <li>
                    Resolved: {incident.resolvedAt ? `${new Date(incident.resolvedAt).toLocaleString()} by ${incident.resolvedByUserId ?? "unknown"}` : "No"}
                  </li>
                </ul>

                <div className="button-row">
                  {!incident.acknowledgedAt ? (
                    <button
                      type="button"
                      onClick={() => acknowledgeMutation.mutate(incident.id)}
                      disabled={acknowledgeMutation.isPending}
                    >
                      {acknowledgeMutation.isPending ? "Acknowledging..." : "Acknowledge"}
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => assignMutation.mutate(incident.id)}
                    disabled={assignMutation.isPending}
                  >
                    {assignMutation.isPending ? "Assigning..." : "Assign to me"}
                  </button>

                  {incident.state !== "RESOLVED" ? (
                    <button
                      type="button"
                      onClick={() => resolveMutation.mutate(incident.id)}
                      disabled={resolveMutation.isPending}
                    >
                      {resolveMutation.isPending ? "Resolving..." : "Resolve"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => reopenMutation.mutate(incident.id)}
                      disabled={reopenMutation.isPending}
                    >
                      {reopenMutation.isPending ? "Reopening..." : "Reopen"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {incidentsQuery.error ? <p className="error">{getErrorMessage(incidentsQuery.error)}</p> : null}
      {acknowledgeMutation.error ? <p className="error">{getErrorMessage(acknowledgeMutation.error)}</p> : null}
      {assignMutation.error ? <p className="error">{getErrorMessage(assignMutation.error)}</p> : null}
      {resolveMutation.error ? <p className="error">{getErrorMessage(resolveMutation.error)}</p> : null}
      {reopenMutation.error ? <p className="error">{getErrorMessage(reopenMutation.error)}</p> : null}
      </>
    );
  }

  return (
    <section className="card role-shell customer-workspace">
      <Routes>
        <Route index element={renderDashboard()} />
        <Route path="users" element={renderUsers()} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </section>
  );
}
