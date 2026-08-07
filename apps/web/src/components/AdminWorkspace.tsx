import { useQuery } from "@tanstack/react-query";
import type { CurrentUser } from "@gpp/shared";
import { getAdminDashboardMetrics, getAdminIncidents, getAdminRuntimeMetrics } from "../lib/api";

type AdminWorkspaceProps = {
  user: CurrentUser;
  accessToken: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function AdminWorkspace({ user, accessToken }: AdminWorkspaceProps): JSX.Element {
  const metricsQuery = useQuery({
    queryKey: ["admin-metrics"],
    queryFn: async () => getAdminDashboardMetrics(accessToken)
  });

  const runtimeMetricsQuery = useQuery({
    queryKey: ["admin-runtime-metrics"],
    queryFn: async () => getAdminRuntimeMetrics(accessToken)
  });

  const incidentsQuery = useQuery({
    queryKey: ["admin-incidents"],
    queryFn: async () => getAdminIncidents(accessToken)
  });

  const metrics = metricsQuery.data;
  const runtimeMetrics = runtimeMetricsQuery.data;
  const incidents = incidentsQuery.data;

  return (
    <section className="card role-shell customer-workspace">
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
        {!incidents ? (
          <p className="subtext">{incidentsQuery.isLoading ? "Loading incidents..." : "No incidents loaded."}</p>
        ) : incidents.incidents.length === 0 ? (
          <p className="subtext">No incidents detected in the current lookback windows.</p>
        ) : (
          <div className="panel-grid">
            {incidents.incidents.slice(0, 12).map((incident) => (
              <article className="panel" key={incident.id}>
                <h3>
                  {incident.severity} - {incident.source}
                </h3>
                <ul className="meta-list compact">
                  <li>{incident.title}</li>
                  <li>{incident.detail}</li>
                  <li>Occurred: {new Date(incident.occurredAt).toLocaleString()}</li>
                  <li>
                    {incident.entityType}: {incident.entityId}
                  </li>
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      {incidentsQuery.error ? <p className="error">{getErrorMessage(incidentsQuery.error)}</p> : null}
    </section>
  );
}
