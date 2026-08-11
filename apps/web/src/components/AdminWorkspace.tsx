import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { AdminIncident, AdminUserWithLocations, CurrentUser, Role } from "@gpp/shared";
import { formatUsd } from "@gpp/shared";
import {
  acknowledgeAdminIncident,
  assignAdminIncident,
  createAdminUser,
  getAdminUser,
  getAdminUserAvailability,
  getAdminUsers,
  setAdminUserAvailability,
  updateAdminUser,
  getAdminDashboardMetrics,
  getAdminIncidents,
  getAdminRuntimeMetrics,
  reopenAdminIncident,
  resolveAdminIncident
} from "../lib/api";
import { TodaysRoute } from "./TodaysRoute";
import { OperatorDashboard } from "./OperatorDashboard";
import { AvailabilityCalendar } from "./AvailabilityCalendar";

type AdminWorkspaceProps = {
  user: CurrentUser;
  accessToken: string;
  refreshUser: () => Promise<void>;
};

export const ADMIN_NAV = [
  { to: "/admin", label: "Dashboard", icon: "📊", end: true },
  { to: "/admin/routes", label: "Today's Routes", icon: "🗺️" },
  { to: "/admin/users", label: "Users", icon: "👥" }
] as const;

const ROLE_LABELS: Record<Role, string> = {
  CUSTOMER: "Customer",
  OPERATOR: "Operator",
  ADMIN: "Admin"
};

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function AdminWorkspace({ user, accessToken, refreshUser }: AdminWorkspaceProps): JSX.Element {
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

  const detailUser = userDetailQuery.data?.user;
  const detailIsOperator = detailUser
    ? detailUser.role === "OPERATOR" || (detailUser.role === "ADMIN" && detailUser.operatorAccess)
    : false;

  const userAvailabilityQuery = useQuery({
    queryKey: ["admin-user-availability", detailUserId],
    queryFn: async () => getAdminUserAvailability(detailUserId as string, accessToken),
    enabled: Boolean(detailUserId) && detailIsOperator
  });

  const setUserAvailabilityMutation = useMutation({
    mutationFn: (dates: string[]) => setAdminUserAvailability(detailUserId as string, dates, accessToken),
    onSuccess: (data) => {
      queryClient.setQueryData(["admin-user-availability", detailUserId], data);
    }
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
                <option value="ADMIN">Admins</option>
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
        key={detail.id}
        user={detail}
        onSave={(id, patch) => updateUserMutation.mutate({ id, patch })}
        saving={updateUserMutation.isPending}
        saveError={updateUserMutation.isError ? getErrorMessage(updateUserMutation.error) : null}
        saved={updateUserMutation.isSuccess}
        showAvailability={detailIsOperator}
        availabilityDates={userAvailabilityQuery.data?.dates ?? []}
        availabilityLoading={userAvailabilityQuery.isLoading}
        onSaveAvailability={(dates) => setUserAvailabilityMutation.mutate(dates)}
        savingAvailability={setUserAvailabilityMutation.isPending}
        availabilitySaved={setUserAvailabilityMutation.isSuccess}
      />
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
            rows={[
              ["Active addresses", metrics.service.addresses],
              ["Active subscriptions", metrics.service.activeSubscriptions],
              ["Active entitlements", metrics.service.activeEntitlements]
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
        <Route path="routes" element={<TodaysRoute accessToken={accessToken} />} />
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
        <Route path="users" element={renderUsers()} />
        <Route path="users/:userId" element={renderUserDetail()} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </section>
  );
}

function AdminUserDetail({
  user,
  onSave,
  saving,
  saveError,
  saved,
  showAvailability,
  availabilityDates,
  availabilityLoading,
  onSaveAvailability,
  savingAvailability,
  availabilitySaved
}: {
  user: AdminUserWithLocations;
  onSave: (
    id: string,
    patch: {
      name: string;
      email: string;
      phone: string | null;
      role: Role;
      requestedServiceArea: string | null;
      operatorAccess: boolean;
    }
  ) => void;
  saving: boolean;
  saveError: string | null;
  saved: boolean;
  showAvailability: boolean;
  availabilityDates: string[];
  availabilityLoading: boolean;
  onSaveAvailability: (dates: string[]) => void;
  savingAvailability: boolean;
  availabilitySaved: boolean;
}): JSX.Element {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [role, setRole] = useState<Role>(user.role);
  const [area, setArea] = useState(user.requestedServiceArea ?? "");
  const [operatorAccess, setOperatorAccess] = useState(user.operatorAccess);
  const [submitted, setSubmitted] = useState(false);

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
    setSubmitted(true);
    onSave(user.id, {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() ? phone.trim() : null,
      role,
      requestedServiceArea: area.trim() ? area.trim() : null,
      operatorAccess: role === "ADMIN" ? operatorAccess : false
    });
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
              <option value="ADMIN">Admin</option>
            </select>
          </label>
          {role === "ADMIN" ? (
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

      {showAvailability ? (
        <article className="panel">
          <h3>Operator availability</h3>
          <p className="subtext">
            Set the days over the next 30 this operator is available to run routes.
          </p>
          <AvailabilityCalendar
            dates={availabilityDates}
            onSave={onSaveAvailability}
            saving={savingAvailability}
            loading={availabilityLoading}
            saved={availabilitySaved}
          />
        </article>
      ) : null}

      <article className="panel">
        <div className="panel-head-row">
          <h3>Locations</h3>
          <span className="detail-total">{formatUsd(user.monthlyCents)}/mo</span>
        </div>
        {user.locations.length === 0 ? (
          <p className="subtext">This user has no service locations.</p>
        ) : (
          <ul className="admin-loc-list">
            {user.locations.map((loc) => (
              <li className="admin-loc-card" key={loc.id}>
                <div className="admin-loc-head">
                  <div>
                    <strong>{loc.line1}</strong>
                    <span className="admin-table-sub">
                      {loc.city}, {loc.state} {loc.postalCode}
                    </span>
                  </div>
                  <span className="admin-loc-price">{formatUsd(loc.monthlyCents)}/mo</span>
                </div>
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
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </article>
    </div>
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
      operatorAccess: role === "ADMIN" ? operatorAccess : false
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
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        {role === "ADMIN" ? (
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
