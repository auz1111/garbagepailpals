import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type {
  AdminIncident,
  AdminUserUpdate,
  AdminUserWithLocations,
  CurrentUser,
  Role,
  ScheduleCan
} from "@gpp/shared";
import { formatUsd, isSuperAdminRole } from "@gpp/shared";
import {
  acknowledgeAdminIncident,
  assignAdminIncident,
  connectHauler,
  createAdminUser,
  deleteAddress,
  getAdminLocations,
  getAdminUser,
  getAdminUsers,
  getNeighborhoods,
  setLocationNeighborhood,
  updateAddress,
  updateAdminUser,
  getAdminDashboardMetrics,
  getAdminIncidents,
  getAdminRuntimeMetrics,
  getZones,
  setLocationApproval,
  setUserZones,
  reopenAdminIncident,
  resolveAdminIncident
} from "../lib/api";
import { TodaysRoute } from "./TodaysRoute";
import { TodaysRoutesHero } from "./TodaysRoutesHero";
import { RouteHistory } from "./RouteHistory";
import { ZonesAdmin } from "./ZonesAdmin";
import { AdminLocations } from "./AdminLocations";
import { AdminHaulerCoverage } from "./AdminHaulerCoverage";
import { LocationServicesEditor } from "./LocationServicesEditor";
import { AddLocationWizard } from "./AddLocationWizard";
import { OperatorDashboard } from "./OperatorDashboard";
import { OperatorsAdmin } from "./OperatorsAdmin";
import { NeighborhoodsAdmin } from "./NeighborhoodsAdmin";

type AdminWorkspaceProps = {
  user: CurrentUser;
  accessToken: string;
  refreshUser: () => Promise<void>;
};

export const ADMIN_NAV = [
  { to: "/admin", label: "Dashboard", icon: "📊", end: true },
  { to: "/admin/routes", label: "Today's Routes", icon: "🗺️" },
  { to: "/admin/history", label: "Route History", icon: "🕓" },
  { to: "/admin/zones", label: "Service Areas", icon: "🗺", superOnly: true },
  { to: "/admin/hauler-coverage", label: "Trash Providers", icon: "♻️", superOnly: true },
  { to: "/admin/neighborhoods", label: "Neighborhoods", icon: "🏘️" },
  { to: "/admin/locations", label: "Locations", icon: "📍" },
  { to: "/admin/users", label: "Users", icon: "👥" },
  { to: "/admin/incidents", label: "Incidents", icon: "🚨" }
] as const;

const ROLE_LABELS: Record<Role, string> = {
  CUSTOMER: "Customer",
  OPERATOR: "Operator",
  ADMIN: "Admin",
  PRO_OPERATOR: "Pro operator",
  PAILPAL: "PailPal",
  SUPER_ADMIN: "Super admin"
};

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

type AdminLocation = AdminUserWithLocations["locations"][number];
type EditDay = {
  dayOfWeek: number;
  cans: ScheduleCan[];
  rollIn: boolean;
  petWasteDogs: number;
  providerSynced: boolean;
  biweeklyAnchorDate: string;
};

const DEFAULT_CANS: ScheduleCan[] = [{ type: "TRASH", cadence: "WEEKLY", count: 1 }];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function AdminWorkspace({ user, accessToken, refreshUser }: AdminWorkspaceProps): JSX.Element {
  const queryClient = useQueryClient();
  const [stateFilter, setStateFilter] = useState<"ALL" | "OPEN" | "ACKNOWLEDGED" | "RESOLVED">("ALL");
  const [sourceFilter, setSourceFilter] = useState<"ALL" | "JOB" | "NOTIFICATION" | "WEBHOOK">("ALL");
  const [severityFilter, setSeverityFilter] = useState<"ALL" | "WARN" | "CRITICAL">("ALL");
  const [ownerFilter, setOwnerFilter] = useState<"ALL" | "MINE" | "UNASSIGNED">("ALL");

  // Locations with no neighborhood yet — surfaced as a banner on every admin page.
  const adminLocationsQuery = useQuery({
    queryKey: ["admin-locations"],
    queryFn: async () => getAdminLocations(accessToken)
  });
  const unassignedLocationCount = (adminLocationsQuery.data?.locations ?? []).filter(
    (loc) => !loc.neighborhoodId
  ).length;

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

  const location = useLocation();
  const navigate = useNavigate();
  const [userRoleFilter, setUserRoleFilter] = useState<"ALL" | Role>("ALL");
  const [userSearch, setUserSearch] = useState("");
  const [showCreateUser, setShowCreateUser] = useState(false);
  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => getAdminUsers(accessToken)
  });

  // The user-detail route is /admin/users/:userId — read the id off the path.
  const userDetailMatch = location.pathname.match(/\/admin\/users\/([^/]+)$/);
  const detailUserId = userDetailMatch?.[1] ? decodeURIComponent(userDetailMatch[1]) : null;

  const userDetailQuery = useQuery({
    queryKey: ["admin-user", detailUserId],
    queryFn: async () => getAdminUser(detailUserId as string, accessToken),
    enabled: Boolean(detailUserId)
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateAdminUser>[1] }) =>
      updateAdminUser(id, patch, accessToken),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.setQueryData(["admin-user", data.user.id], data);
      // If we just edited our own account, refresh the session so role/operator
      // access propagate to the nav and route guards immediately.
      if (data.user.id === user.id) {
        await refreshUser();
      }
    }
  });

  const createUserMutation = useMutation({
    mutationFn: (input: Parameters<typeof createAdminUser>[0]) => createAdminUser(input, accessToken),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setShowCreateUser(false);
    }
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
    const term = userSearch.trim().toLowerCase();
    const rows = all
      .filter((u) => userRoleFilter === "ALL" || u.role === userRoleFilter)
      .filter(
        (u) =>
          term === "" ||
          u.name.toLowerCase().includes(term) ||
          u.email.toLowerCase().includes(term) ||
          u.locationLabels.some((label) => label.toLowerCase().includes(term))
      );
    const counts = all.reduce<Record<string, number>>((acc, u) => {
      acc[u.role] = (acc[u.role] ?? 0) + 1;
      return acc;
    }, {});
    return (
      <div className="dash-page">
        <div className="dash-page-head">
          <div className="panel-head-row">
            <div>
              <h2>Users</h2>
              <p className="subtext">
                {all.length} total · {counts.CUSTOMER ?? 0} customers · {counts.OPERATOR ?? 0}{" "}
                operators · {counts.ADMIN ?? 0} admins
              </p>
            </div>
            {!showCreateUser ? (
              <button
                type="button"
                className="add-address-btn"
                onClick={() => {
                  createUserMutation.reset();
                  setShowCreateUser(true);
                }}
              >
                + Add user
              </button>
            ) : null}
          </div>
        </div>

        {showCreateUser ? (
          <CreateUserForm
            onCancel={() => setShowCreateUser(false)}
            onCreate={(input) => createUserMutation.mutate(input)}
            pending={createUserMutation.isPending}
            error={createUserMutation.isError ? getErrorMessage(createUserMutation.error) : null}
          />
        ) : null}

        <article className="panel">
          <div className="admin-filters">
            <label className="admin-filter-search">
              Search
              <input
                type="search"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="Name, email, or location…"
              />
            </label>
            <label className="admin-filter-role">
              Role
              <select
                value={userRoleFilter}
                onChange={(event) => setUserRoleFilter(event.target.value as "ALL" | Role)}
              >
                <option value="ALL">All roles</option>
                <option value="CUSTOMER">Customers</option>
                <option value="OPERATOR">Operators</option>
                <option value="PRO_OPERATOR">Pro operators</option>
                <option value="ADMIN">Admins</option>
                <option value="SUPER_ADMIN">Super admins</option>
              </select>
            </label>
          </div>
          <p className="subtext admin-filter-count">
            Showing {rows.length} of {all.length}
          </p>

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
                    <tr
                      key={entry.id}
                      className="is-clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/admin/users/${entry.id}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          navigate(`/admin/users/${entry.id}`);
                        }
                      }}
                    >
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

  function renderUserDetail(): JSX.Element {
    if (userDetailQuery.isLoading) {
      return (
        <div className="dash-page">
          <article className="panel">
            <p className="subtext">Loading user…</p>
          </article>
        </div>
      );
    }
    const detail = userDetailQuery.data?.user;
    if (!detail) {
      return (
        <div className="dash-page">
          <div className="dash-page-head">
            <Link to="/admin/users" className="back-link">
              ← Back to users
            </Link>
            <h2>User not found</h2>
          </div>
        </div>
      );
    }
    return (
      <AdminUserDetail
        key={`${detail.id}:${detail.role}:${detail.operatorAccess}`}
        user={detail}
        accessToken={accessToken}
        onSave={(id, patch) => updateUserMutation.mutate({ id, patch })}
        saving={updateUserMutation.isPending}
        saveError={updateUserMutation.isError ? getErrorMessage(updateUserMutation.error) : null}
        saved={updateUserMutation.isSuccess}
      />
    );
  }

  function renderDashboard(): JSX.Element {
    return (
      <>
        <h2>Admin Dashboard</h2>
      <p className="subtext">Signed in as {user.name}. Metrics refresh on page load.</p>

      <TodaysRoutesHero accessToken={accessToken} />

      {metrics && metrics.service.pendingApproval > 0 ? (
        <div className="update-banner is-warn" role="status">
          <span className="update-banner-icon" aria-hidden="true">⏳</span>
          <div className="update-banner-text">
            <strong>
              {metrics.service.pendingApproval} location
              {metrics.service.pendingApproval === 1 ? "" : "s"} awaiting approval
            </strong>
            <span>
              {metrics.service.pendingApprovalBilled > 0
                ? `${metrics.service.pendingApprovalBilled} already being billed — approve to start service.`
                : "Approve them to make them serviceable and routable."}
            </span>
          </div>
          <Link to="/admin/locations?filter=pending" className="update-banner-cta">
            Review
          </Link>
        </div>
      ) : null}

      {!metrics ? (
        <p className="subtext">{metricsQuery.isLoading ? "Loading metrics..." : "No metrics available yet."}</p>
      ) : (
        <div className="metric-grid">
          <MetricCard
            icon="👥"
            title="Users"
            to="/admin/users"
            rows={[
              ["Total", metrics.users.total],
              ["Customers", metrics.users.customers],
              ["Operators", metrics.users.operators],
              ["Admins", metrics.users.admins]
            ]}
          />
          <MetricCard
            icon="🗑️"
            title="Service"
            to="/admin/locations"
            rows={[
              ["Active addresses", metrics.service.addresses],
              ["Active subscriptions", metrics.service.activeSubscriptions],
              ["Pending approval", metrics.service.pendingApproval]
            ]}
          />
          <MetricCard
            icon="🚚"
            title="Jobs"
            rows={[
              ["Scheduled next 7 days", metrics.jobs.scheduledNext7Days],
              ["Completed last 7 days", metrics.jobs.completedLast7Days],
              ["Failed last 7 days", metrics.jobs.failedLast7Days]
            ]}
          />
          <MetricCard
            icon="🔌"
            title="Webhooks (24h)"
            rows={[
              ["Stripe events", metrics.webhooks.stripeLast24h],
              ["PayPal events", metrics.webhooks.paypalLast24h]
            ]}
          />
          <MetricCard
            icon="🔔"
            title="Notifications (24h)"
            rows={[
              ["Reminders sent", metrics.notifications.remindersSentLast24h],
              ["Reminders failed", metrics.notifications.remindersFailedLast24h],
              ["Overdue sent", metrics.notifications.overdueSentLast24h],
              ["Overdue failed", metrics.notifications.overdueFailedLast24h]
            ]}
          />
        </div>
      )}

      {metricsQuery.error ? <p className="error">{getErrorMessage(metricsQuery.error)}</p> : null}

      {runtimeMetrics ? (
        <div className="metric-grid" style={{ marginTop: "1rem" }}>
          <MetricCard
            icon="⚙️"
            title="Runtime"
            rows={[
              ["Started", new Date(runtimeMetrics.runtime.startedAt).toLocaleString()],
              ["Uptime", `${runtimeMetrics.runtime.uptimeSeconds}s`],
              ["Notification provider", runtimeMetrics.notifications.provider]
            ]}
          />
          <MetricCard
            icon="🛡️"
            title="Auth Throttle"
            rows={[
              ["Window", `${runtimeMetrics.authRateLimits.windowMs}ms`],
              [
                "Register allowed/blocked",
                `${runtimeMetrics.authRateLimits.register.allowed}/${runtimeMetrics.authRateLimits.register.blocked}`
              ],
              [
                "Login allowed/blocked",
                `${runtimeMetrics.authRateLimits.login.allowed}/${runtimeMetrics.authRateLimits.login.blocked}`
              ],
              [
                "Refresh allowed/blocked",
                `${runtimeMetrics.authRateLimits.refresh.allowed}/${runtimeMetrics.authRateLimits.refresh.blocked}`
              ]
            ]}
          />
          <MetricCard
            icon="🔁"
            title="Notification Retry"
            rows={[
              ["Max retries", runtimeMetrics.notifications.maxRetries],
              ["Base retry delay", `${runtimeMetrics.notifications.retryBaseDelayMs}ms`]
            ]}
          />
        </div>
      ) : (
        <p className="subtext" style={{ marginTop: "1rem" }}>
          {runtimeMetricsQuery.isLoading ? "Loading runtime metrics..." : "Runtime metrics unavailable."}
        </p>
      )}

      {runtimeMetricsQuery.error ? <p className="error">{getErrorMessage(runtimeMetricsQuery.error)}</p> : null}

      <article className="panel important-links" style={{ marginTop: "1rem" }}>
        <h3>Important links</h3>
        <div className="important-link-grid">
          <Link to="/service-area" className="important-link">
            <span className="important-link-icon" aria-hidden="true">
              📍
            </span>
            <span className="important-link-body">
              <strong>Service area form</strong>
              <span className="important-link-sub">Check or request a service area</span>
            </span>
            <span className="important-link-arrow" aria-hidden="true">
              →
            </span>
          </Link>
        </div>
      </article>
      </>
    );
  }

  function renderIncidents(): JSX.Element {
    return (
      <>
        <h2>Incidents</h2>
        <p className="subtext">Operational alerts from jobs, notifications, and webhooks.</p>

        <div className="panel" style={{ margin: "1rem 0 0.75rem" }}>
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
      {unassignedLocationCount > 0 ? (
        <div className="update-banner is-warn" role="status">
          <span className="update-banner-icon" aria-hidden="true">
            🏘️
          </span>
          <div className="update-banner-text">
            <strong>
              {unassignedLocationCount} location{unassignedLocationCount === 1 ? "" : "s"} need a
              neighborhood.
            </strong>
            <span>Assign each to a neighborhood so it can be added to routes.</span>
          </div>
          <Link to="/admin/neighborhoods" className="update-banner-cta">
            Assign
          </Link>
        </div>
      ) : null}
      <Routes>
        <Route index element={renderDashboard()} />
        <Route path="routes" element={<TodaysRoute accessToken={accessToken} />} />
        <Route path="history" element={<RouteHistory accessToken={accessToken} />} />
        <Route path="zones" element={<ZonesAdmin accessToken={accessToken} />} />
        <Route path="hauler-coverage" element={<AdminHaulerCoverage accessToken={accessToken} />} />
        <Route path="locations" element={<AdminLocations accessToken={accessToken} />} />
        <Route path="neighborhoods" element={<NeighborhoodsAdmin accessToken={accessToken} />} />
        <Route path="operators" element={<OperatorsAdmin accessToken={accessToken} />} />
        <Route
          path="operator"
          element={
            user.operatorAccess ? (
              <OperatorDashboard user={user} accessToken={accessToken} />
            ) : (
              <Navigate to="/admin" replace />
            )
          }
        />
        <Route path="incidents" element={renderIncidents()} />
        <Route path="users" element={renderUsers()} />
        <Route path="users/:userId" element={renderUserDetail()} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </section>
  );
}

function AdminUserDetail({
  user,
  accessToken,
  onSave,
  saving,
  saveError,
  saved
}: {
  user: AdminUserWithLocations;
  accessToken: string;
  onSave: (id: string, patch: AdminUserUpdate) => void;
  saving: boolean;
  saveError: string | null;
  saved: boolean;
}): JSX.Element {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [role, setRole] = useState<Role>(user.role);
  const [area, setArea] = useState(user.requestedServiceArea ?? "");
  const [operatorAccess, setOperatorAccess] = useState(user.operatorAccess);
  const [submitted, setSubmitted] = useState(false);
  const [addingLocation, setAddingLocation] = useState(false);

  // Admins grant zones to operators (serviceable areas) and pro-operators (admin
  // scope). Approving a requested zone = checking it.
  const showZoneGrants =
    user.role === "PRO_OPERATOR" || user.role === "OPERATOR" || user.role === "PAILPAL";
  const requestedSet = new Set(user.requestedZoneIds);
  const detailQueryClient = useQueryClient();
  const grantZonesQuery = useQuery({
    queryKey: ["zones"],
    queryFn: async () => getZones(accessToken),
    enabled: showZoneGrants
  });
  const grantZones = grantZonesQuery.data?.zones ?? [];
  const grantedSet = new Set(user.grantedZoneIds);
  const grantMutation = useMutation({
    mutationFn: (zoneIds: string[]) => setUserZones(user.id, zoneIds, accessToken),
    onSuccess: () => {
      void detailQueryClient.invalidateQueries({ queryKey: ["admin-user", user.id] });
      void detailQueryClient.invalidateQueries({ queryKey: ["admin-users"] });
    }
  });
  const toggleGrant = (id: string) => {
    const next = grantedSet.has(id)
      ? user.grantedZoneIds.filter((x) => x !== id)
      : [...user.grantedZoneIds, id];
    grantMutation.mutate(next);
  };

  const dirty =
    name !== user.name ||
    email !== user.email ||
    phone !== (user.phone ?? "") ||
    role !== user.role ||
    area !== (user.requestedServiceArea ?? "") ||
    operatorAccess !== user.operatorAccess;
  const valid = name.trim().length > 0 && /.+@.+\..+/.test(email.trim());

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!valid || !dirty) {
      return;
    }
    // Send ONLY the fields the user actually changed. The server treats an
    // omitted field as "leave unchanged", so a partial patch can never silently
    // clobber a value (e.g. operatorAccess) the admin didn't touch.
    const patch: AdminUserUpdate = {};
    if (name.trim() !== user.name) patch.name = name.trim();
    if (email.trim() !== user.email) patch.email = email.trim();
    const nextPhone = phone.trim() ? phone.trim() : null;
    if (nextPhone !== (user.phone ?? null)) patch.phone = nextPhone;
    if (role !== user.role) patch.role = role;
    const nextArea = area.trim() ? area.trim() : null;
    if (nextArea !== (user.requestedServiceArea ?? null)) patch.requestedServiceArea = nextArea;
    const nextOperatorAccess = isSuperAdminRole(role) ? operatorAccess : false;
    if (nextOperatorAccess !== user.operatorAccess) patch.operatorAccess = nextOperatorAccess;

    if (Object.keys(patch).length === 0) {
      return;
    }
    setSubmitted(true);
    onSave(user.id, patch);
  }

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <Link to="/admin/users" className="back-link">
          ← Back to users
        </Link>
        <h2>{user.name}</h2>
        <p className="subtext">{user.email}</p>
      </div>

      <article className="panel admin-summary">
        <div className="admin-summary-stats">
          <div className="admin-stat">
            <span className="admin-stat-label">Role</span>
            <strong>{ROLE_LABELS[user.role]}</strong>
          </div>
          <div className="admin-stat">
            <span className="admin-stat-label">Locations</span>
            <strong>{user.role === "CUSTOMER" ? user.addressCount : "—"}</strong>
          </div>
          <div className="admin-stat">
            <span className="admin-stat-label">Plan</span>
            {user.role === "CUSTOMER" ? (
              <span
                className={`coverage-badge ${user.activeSubscription ? "covered" : "uncovered"}`}
              >
                {user.activeSubscription ? "Active" : "None"}
              </span>
            ) : (
              <strong>—</strong>
            )}
          </div>
          <div className="admin-stat">
            <span className="admin-stat-label">Monthly</span>
            <strong>{user.role === "CUSTOMER" ? `${formatUsd(user.monthlyCents)}/mo` : "—"}</strong>
          </div>
          <div className="admin-stat">
            <span className="admin-stat-label">Joined</span>
            <strong>{new Date(user.createdAt).toLocaleDateString()}</strong>
          </div>
        </div>
      </article>

      <form onSubmit={handleSubmit}>
        <article className="panel">
          <h3>Account information</h3>
          <label className="field-single">
            Role
            <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
              <option value="CUSTOMER">Customer</option>
              <option value="OPERATOR">Operator</option>
              <option value="PAILPAL">PailPal</option>
              <option value="PRO_OPERATOR">Pro operator</option>
              <option value="ADMIN">Admin</option>
              <option value="SUPER_ADMIN">Super admin</option>
            </select>
          </label>
          {isSuperAdminRole(role) ? (
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={operatorAccess}
                onChange={(event) => setOperatorAccess(event.target.checked)}
              />
              <span>
                <strong>Operator access</strong>
                <span className="subtext">
                  Adds an Operator dashboard to this admin's menu for servicing pickups.
                </span>
              </span>
            </label>
          ) : null}
          <label className="field-single">
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field-single">
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="field-single">
            Phone
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="field-single">
            Requested area
            <input
              value={area}
              onChange={(event) => setArea(event.target.value)}
              placeholder="e.g. 97702"
            />
          </label>
          <div className="detail-save-row">
            <button type="submit" className="cta-primary" disabled={!valid || !dirty || saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            {submitted && saved && !saving && !dirty && !saveError ? (
              <span className="success-inline">Saved.</span>
            ) : null}
          </div>
          {saveError ? <p className="error">{saveError}</p> : null}
        </article>
      </form>

      <article className="panel">
        <div className="panel-head-row">
          <h3>Locations</h3>
          <div className="panel-head-actions">
            <span className="detail-total">{formatUsd(user.monthlyCents)}/mo</span>
            {user.role === "CUSTOMER" && !addingLocation ? (
              <button
                type="button"
                className="add-address-btn"
                onClick={() => setAddingLocation(true)}
              >
                + Add Location
              </button>
            ) : null}
          </div>
        </div>

        {addingLocation ? (
          <AddLocationWizard
            accessToken={accessToken}
            targetUserId={user.id}
            onInvalidate={async () => {
              await detailQueryClient.invalidateQueries({ queryKey: ["admin-user", user.id] });
              await detailQueryClient.invalidateQueries({ queryKey: ["admin-users"] });
              await detailQueryClient.invalidateQueries({ queryKey: ["admin-locations"] });
            }}
            onCancel={() => setAddingLocation(false)}
            onDone={() => setAddingLocation(false)}
          />
        ) : null}

        {user.locations.length === 0 && !addingLocation ? (
          <p className="subtext">This user has no service locations.</p>
        ) : user.locations.length > 0 ? (
          <ul className="admin-loc-list">
            {user.locations.map((loc) => (
              <AdminLocationCard
                key={loc.id}
                loc={loc}
                userId={user.id}
                accessToken={accessToken}
              />
            ))}
          </ul>
        ) : null}
      </article>

      {showZoneGrants ? (
        <article className="panel">
          <h3>{user.role === "OPERATOR" ? "Serviceable areas" : "Granted zones"}</h3>
          <p className="subtext">
            {user.role === "OPERATOR"
              ? "Areas this operator serves. Check an area to grant it (approving any request); uncheck to remove."
              : "Zones this pro-operator can administer and operate in. They only see and route these areas."}
          </p>
          {grantZones.length === 0 ? (
            <p className="subtext">No zones exist yet — create them under Service Areas.</p>
          ) : (
            <ul className="serve-zone-list">
              {grantZones.map((z) => {
                const pending = requestedSet.has(z.id) && !grantedSet.has(z.id);
                return (
                  <li
                    className={`serve-zone${grantedSet.has(z.id) ? " is-on" : pending ? " is-requested" : ""}`}
                    key={z.id}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={grantedSet.has(z.id)}
                        disabled={grantMutation.isPending}
                        onChange={() => toggleGrant(z.id)}
                      />
                      <span className="serve-zone-name">{z.name}</span>
                      {pending ? <span className="serve-zone-tag">Requested</span> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {grantMutation.isError ? <p className="error">{getErrorMessage(grantMutation.error)}</p> : null}
        </article>
      ) : null}
    </div>
  );
}

function AdminLocationCard({
  loc,
  userId,
  accessToken
}: {
  loc: AdminLocation;
  userId: string;
  accessToken: string;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);

  // When arrived at via a map-popup link (…#address-<id>), scroll this card into
  // view and briefly highlight it.
  useEffect(() => {
    if (window.location.hash === `#address-${loc.id}`) {
      const el = document.getElementById(`address-${loc.id}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [loc.id]);

  const neighborhoodsQuery = useQuery({
    queryKey: ["neighborhoods"],
    queryFn: async () => getNeighborhoods(accessToken)
  });
  const neighborhoods = neighborhoodsQuery.data?.neighborhoods ?? [];
  const neighborhoodName = loc.neighborhoodId
    ? neighborhoods.find((n) => n.id === loc.neighborhoodId)?.name
    : null;

  const refreshLists = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin-user", userId] });
    await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
  };

  const addressMutation = useMutation({
    mutationFn: async (patch: {
      line1: string;
      city: string;
      state: string;
      postalCode: string;
      neighborhoodId: string | null;
    }) => {
      const addressChanged =
        patch.line1 !== loc.line1 ||
        patch.city !== loc.city ||
        patch.state !== loc.state ||
        patch.postalCode !== loc.postalCode;
      if (addressChanged) {
        await updateAddress(
          loc.id,
          { line1: patch.line1, city: patch.city, state: patch.state, postalCode: patch.postalCode },
          accessToken
        );
      }
      if (patch.neighborhoodId !== (loc.neighborhoodId ?? null)) {
        await setLocationNeighborhood(loc.id, patch.neighborhoodId, accessToken);
      }
    },
    onSuccess: async () => {
      await refreshLists();
      // Neighborhood counts changed, so refresh those views too.
      await queryClient.invalidateQueries({ queryKey: ["neighborhoods"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-locations"] });
      setEditingAddress(false);
    }
  });


  const deleteMutation = useMutation({
    mutationFn: () => deleteAddress(loc.id, accessToken),
    onSuccess: async () => {
      // Removing a location changes counts + monthly totals across admin views.
      await refreshLists();
      await queryClient.invalidateQueries({ queryKey: ["neighborhoods"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-locations"] });
    }
  });

  const approvalMutation = useMutation({
    mutationFn: (approved: boolean) => setLocationApproval(loc.id, approved, accessToken),
    onSuccess: async () => {
      // Approval flips serviceability, so refresh the location, dashboard, and
      // route views that key off it.
      await refreshLists();
      await queryClient.invalidateQueries({ queryKey: ["admin-locations"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-metrics"] });
    }
  });

  return (
    <li className="admin-loc-card" id={`address-${loc.id}`}>
      <div className="admin-loc-head">
        <div>
          <div className="admin-loc-title">
            <strong>{loc.line1}</strong>
            {loc.neighborhoodId ? (
              <span className="admin-loc-hood">🏘️ {neighborhoodName ?? "Neighborhood"}</span>
            ) : (
              <span className="admin-loc-hood admin-loc-hood-empty">No neighborhood</span>
            )}
            {loc.haulerProvider ? (
              <span className="loc-chip is-provider">♻️ {loc.haulerProviderLabel ?? "Provider linked"}</span>
            ) : (
              <span className="loc-chip is-none">No trash provider</span>
            )}
            {loc.serviceApproved ? (
              <span className="loc-chip is-approved">✓ Approved</span>
            ) : loc.billed ? (
              <span className="loc-chip is-pending">⏳ Pending approval</span>
            ) : (
              <span className="loc-chip is-awaiting">💳 Awaiting billing</span>
            )}
          </div>
          <span className="admin-table-sub">
            {loc.city}, {loc.state} {loc.postalCode}
          </span>
        </div>
        <span className="admin-loc-price">{formatUsd(loc.monthlyCents)}/mo</span>
      </div>

      {editingAddress ? (
        <AdminAddressEditorForm
          loc={loc}
          neighborhoods={neighborhoods}
          saving={addressMutation.isPending}
          error={addressMutation.isError ? getErrorMessage(addressMutation.error) : null}
          onCancel={() => setEditingAddress(false)}
          onSave={(patch) => addressMutation.mutate(patch)}
        />
      ) : null}

      {loc.pickups.length === 0 ? (
        <p className="subtext">No pickup schedule set.</p>
      ) : (
        <ul className="admin-loc-pickups">
          {loc.pickups.map((pickup, index) => (
            <li key={index}>
              <strong>{WEEKDAYS_SHORT[pickup.dayOfWeek]}</strong>
              <span>
                {pickup.canCount} can{pickup.canCount === 1 ? "" : "s"} ·{" "}
                {pickup.cadence === "BIWEEKLY" ? "every 2 weeks" : "weekly"} ·{" "}
                {pickup.rollIn ? "roll-in" : "roll-out only"}
              </span>
              {!pickup.providerSynced ? (
                <span className="loc-chip is-none">Not synced</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <div className="admin-schedule-editor">
          <LocationServicesEditor
            addressId={loc.id}
            accessToken={accessToken}
            connectProvider={connectHauler}
            onChanged={refreshLists}
          />
          <button type="button" className="ghost-btn" onClick={() => setEditing(false)}>
            Done editing
          </button>
        </div>
      ) : editingAddress ? null : (
        <div className="admin-loc-actions">
          {loc.serviceApproved ? (
            <button
              type="button"
              className="ghost-btn"
              disabled={approvalMutation.isPending}
              onClick={() => approvalMutation.mutate(false)}
            >
              {approvalMutation.isPending ? "Saving…" : "Revoke approval"}
            </button>
          ) : loc.billed ? (
            <button
              type="button"
              className="cta-primary"
              disabled={approvalMutation.isPending}
              onClick={() => approvalMutation.mutate(true)}
            >
              {approvalMutation.isPending ? "Approving…" : "✓ Approve for service"}
            </button>
          ) : (
            <span className="loc-awaiting-note">💳 Waiting for the customer to activate their plan</span>
          )}
          <button type="button" className="ghost-btn" onClick={() => setEditing(true)}>
            Edit schedule
          </button>
          <button type="button" className="ghost-btn" onClick={() => setEditingAddress(true)}>
            Edit address
          </button>
          <button
            type="button"
            className="ghost-btn is-danger"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Remove ${loc.line1}? This cancels its scheduled pickups and can't be undone.`
                )
              ) {
                deleteMutation.mutate();
              }
            }}
          >
            {deleteMutation.isPending ? "Removing…" : "Remove location"}
          </button>
        </div>
      )}
      {deleteMutation.isError ? (
        <p className="error">{getErrorMessage(deleteMutation.error)}</p>
      ) : null}
    </li>
  );
}

function AdminAddressEditorForm({
  loc,
  neighborhoods,
  saving,
  error,
  onCancel,
  onSave
}: {
  loc: AdminLocation;
  neighborhoods: { id: string; name: string }[];
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (patch: {
    line1: string;
    city: string;
    state: string;
    postalCode: string;
    neighborhoodId: string | null;
  }) => void;
}): JSX.Element {
  const [line1, setLine1] = useState(loc.line1);
  const [city, setCity] = useState(loc.city);
  const [state, setState] = useState(loc.state);
  const [postalCode, setPostalCode] = useState(loc.postalCode);
  const [neighborhoodId, setNeighborhoodId] = useState(loc.neighborhoodId ?? "");

  const valid =
    line1.trim().length > 0 &&
    city.trim().length > 0 &&
    state.trim().length >= 2 &&
    postalCode.trim().length >= 3;
  const dirty =
    line1.trim() !== loc.line1 ||
    city.trim() !== loc.city ||
    state.trim() !== loc.state ||
    postalCode.trim() !== loc.postalCode ||
    (neighborhoodId || null) !== (loc.neighborhoodId ?? null);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!valid || !dirty) return;
    onSave({
      line1: line1.trim(),
      city: city.trim(),
      state: state.trim(),
      postalCode: postalCode.trim(),
      neighborhoodId: neighborhoodId || null
    });
  }

  return (
    <form className="admin-schedule-editor" onSubmit={handleSubmit}>
      <label className="field-single">
        Street address
        <input value={line1} onChange={(event) => setLine1(event.target.value)} />
      </label>
      <div className="field-row">
        <label>
          City
          <input value={city} onChange={(event) => setCity(event.target.value)} />
        </label>
        <label>
          State
          <input value={state} onChange={(event) => setState(event.target.value)} />
        </label>
        <label>
          ZIP
          <input value={postalCode} onChange={(event) => setPostalCode(event.target.value)} />
        </label>
      </div>
      <label className="field-single">
        Neighborhood
        <select value={neighborhoodId} onChange={(event) => setNeighborhoodId(event.target.value)}>
          <option value="">Unassigned</option>
          {neighborhoods.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </label>
      <p className="subtext">Saving re-checks the service area and updates map coordinates.</p>
      <div className="admin-loc-actions">
        <button type="submit" className="cta-primary" disabled={!valid || !dirty || saving}>
          {saving ? "Saving…" : "Update address"}
        </button>
        <button type="button" className="ghost-btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

function CreateUserForm({
  onCancel,
  onCreate,
  pending,
  error
}: {
  onCancel: () => void;
  onCreate: (input: {
    name: string;
    email: string;
    password: string;
    role: Role;
    phone?: string;
    operatorAccess?: boolean;
  }) => void;
  pending: boolean;
  error: string | null;
}): JSX.Element {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("CUSTOMER");
  const [operatorAccess, setOperatorAccess] = useState(false);

  const valid = name.trim().length > 0 && /.+@.+\..+/.test(email.trim()) && password.length >= 8;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!valid) {
      return;
    }
    onCreate({
      name: name.trim(),
      email: email.trim(),
      password,
      role,
      phone: phone.trim() ? phone.trim() : undefined,
      operatorAccess: isSuperAdminRole(role) ? operatorAccess : false
    });
  }

  return (
    <article className="panel">
      <div className="panel-head-row">
        <h3>Add user</h3>
        <button type="button" className="link-inline" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <form onSubmit={handleSubmit}>
        <label className="field-single">
          Role
          <select value={role} onChange={(event) => setRole(event.target.value as Role)}>
            <option value="CUSTOMER">Customer</option>
            <option value="OPERATOR">Operator</option>
            <option value="PAILPAL">PailPal</option>
            <option value="PRO_OPERATOR">Pro operator</option>
            <option value="ADMIN">Admin</option>
            <option value="SUPER_ADMIN">Super admin</option>
          </select>
        </label>
        {isSuperAdminRole(role) ? (
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={operatorAccess}
              onChange={(event) => setOperatorAccess(event.target.checked)}
            />
            <span>
              <strong>Operator access</strong>
              <span className="subtext">Give this admin the operator dashboard.</span>
            </span>
          </label>
        ) : null}
        <label className="field-single">
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field-single">
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="field-single">
          Temporary password
          <input
            type="text"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
          />
        </label>
        <label className="field-single">
          Phone
          <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Optional" />
        </label>
        <div className="detail-save-row">
          <button type="submit" className="cta-primary" disabled={!valid || pending}>
            {pending ? "Creating…" : "Create user"}
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </form>
    </article>
  );
}

function MetricCard({
  icon,
  title,
  rows,
  to
}: {
  icon: string;
  title: string;
  rows: Array<[string, ReactNode]>;
  to?: string;
}): JSX.Element {
  const body = (
    <>
      <div className="metric-head">
        <span className="metric-icon" aria-hidden="true">
          {icon}
        </span>
        <h3>{title}</h3>
        {to ? <span className="metric-link-hint">View →</span> : null}
      </div>
      <ul className="metric-list">
        {rows.map(([label, value]) => (
          <li key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </li>
        ))}
      </ul>
    </>
  );

  return to ? (
    <Link to={to} className="metric-card is-link">
      {body}
    </Link>
  ) : (
    <article className="metric-card">{body}</article>
  );
}
