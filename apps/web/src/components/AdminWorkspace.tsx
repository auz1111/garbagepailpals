import { useQuery } from "@tanstack/react-query";
import type { CurrentUser } from "@gpp/shared";
import { getAdminDashboardMetrics } from "../lib/api";

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

  const metrics = metricsQuery.data;

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
    </section>
  );
}
