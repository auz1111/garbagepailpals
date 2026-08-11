import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CurrentUser, OperatorQueueJob } from "@gpp/shared";
import { claimOperatorJob, getOperatorQueue, updateOperatorJobStatus } from "../lib/api";

type OperatorDashboardProps = {
  user: CurrentUser;
  accessToken: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function OperatorDashboard({ user, accessToken }: OperatorDashboardProps): JSX.Element {
  const queryClient = useQueryClient();

  const queueQuery = useQuery({
    queryKey: ["operator-queue"],
    queryFn: async () => getOperatorQueue(accessToken)
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["operator-queue"] });

  const claimMutation = useMutation({
    mutationFn: (jobId: string) => claimOperatorJob(jobId, accessToken),
    onSuccess: invalidate
  });
  const completeMutation = useMutation({
    mutationFn: (jobId: string) => updateOperatorJobStatus(jobId, { status: "COMPLETED" }, accessToken),
    onSuccess: invalidate
  });
  const failMutation = useMutation({
    mutationFn: (jobId: string) =>
      updateOperatorJobStatus(
        jobId,
        { status: "FAILED", failureReason: "Marked failed from dashboard" },
        accessToken
      ),
    onSuccess: invalidate
  });

  const jobs = useMemo(
    () =>
      [...(queueQuery.data?.jobs ?? [])].sort(
        (a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()
      ),
    [queueQuery.data]
  );

  const stats = useMemo(() => {
    const todays = jobs.filter((j) => isToday(j.scheduledDate));
    return {
      today: todays.length,
      rollOut: todays.filter((j) => j.type === "CURB_OUT").length,
      rollIn: todays.filter((j) => j.type === "CURB_IN").length,
      remaining: jobs.filter((j) => j.status === "SCHEDULED").length
    };
  }, [jobs]);

  const anyError = claimMutation.error ?? completeMutation.error ?? failMutation.error;

  function actionsFor(job: OperatorQueueJob): JSX.Element {
    if (job.status !== "SCHEDULED") {
      return <span className={`coverage-badge ${job.status === "COMPLETED" ? "covered" : "uncovered"}`}>{job.status}</span>;
    }
    return (
      <div className="button-row">
        {!job.assignedOperatorId ? (
          <button type="button" onClick={() => claimMutation.mutate(job.id)} disabled={claimMutation.isPending}>
            Claim
          </button>
        ) : null}
        <button type="button" onClick={() => completeMutation.mutate(job.id)} disabled={completeMutation.isPending}>
          Complete
        </button>
        <button type="button" className="address-row-remove" onClick={() => failMutation.mutate(job.id)} disabled={failMutation.isPending}>
          Fail
        </button>
      </div>
    );
  }

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <h2>Operator Dashboard</h2>
        <p className="subtext">Signed in as {user.name}. Your upcoming pickups (next 7 days).</p>
      </div>

      <article className="panel">
        <div className="route-summary">
          <div className="admin-stat">
            <span className="admin-stat-label">Today</span>
            <strong>{stats.today}</strong>
          </div>
          <div className="admin-stat">
            <span className="admin-stat-label">Roll-outs today</span>
            <strong>{stats.rollOut}</strong>
          </div>
          <div className="admin-stat">
            <span className="admin-stat-label">Roll-ins today</span>
            <strong>{stats.rollIn}</strong>
          </div>
          <div className="admin-stat">
            <span className="admin-stat-label">Scheduled (7 days)</span>
            <strong>{stats.remaining}</strong>
          </div>
        </div>
      </article>

      <article className="panel">
        <h3>Job queue</h3>
        {queueQuery.isLoading ? (
          <p className="subtext">Loading jobs…</p>
        ) : queueQuery.isError ? (
          <p className="error">{getErrorMessage(queueQuery.error)}</p>
        ) : jobs.length === 0 ? (
          <p className="subtext">No jobs scheduled in the next 7 days.</p>
        ) : (
          <ul className="op-job-list">
            {jobs.map((job) => (
              <li className="op-job" key={job.id}>
                <div className="op-job-main">
                  <strong>{job.addressLine1}</strong>
                  <span className="admin-table-sub">
                    {job.city}, {job.state} {job.postalCode} · {job.customerName}
                  </span>
                  <span className="admin-table-sub">
                    {new Date(job.scheduledDate).toLocaleString()} ·{" "}
                    {job.type === "CURB_OUT" ? "Roll-out" : "Roll-in"}
                  </span>
                </div>
                {actionsFor(job)}
              </li>
            ))}
          </ul>
        )}
        {anyError ? <p className="error">{getErrorMessage(anyError)}</p> : null}
      </article>
    </div>
  );
}
