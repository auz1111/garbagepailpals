import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CurrentUser, DailyRoute, OperatorQueueJob } from "@gpp/shared";
import {
  acceptOperatorRoute,
  claimOperatorJob,
  getOperatorAvailability,
  getOperatorQueue,
  getOperatorRoutes,
  setOperatorAvailability,
  updateOperatorJobStatus
} from "../lib/api";

function routeMapsUrl(route: DailyRoute): string {
  const points = [
    ...(route.start ? [`${route.start.lat},${route.start.lng}`] : []),
    ...route.stops.map((s) => `${s.lat},${s.lng}`),
    ...(route.end ? [`${route.end.lat},${route.end.lng}`] : [])
  ];
  return `https://www.google.com/maps/dir/${points.map(encodeURIComponent).join("/")}`;
}

function formatMiles(meters: number): string {
  return `${(meters / 1609.34).toFixed(1)} mi`;
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

type OperatorDashboardProps = {
  user: CurrentUser;
  accessToken: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const NEXT_30_DAYS: Date[] = Array.from({ length: 30 }, (_, i) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + i);
  return d;
});

export function OperatorDashboard({ user, accessToken }: OperatorDashboardProps): JSX.Element {
  const queryClient = useQueryClient();

  const queueQuery = useQuery({
    queryKey: ["operator-queue"],
    queryFn: async () => getOperatorQueue(accessToken)
  });

  const routesQuery = useQuery({
    queryKey: ["operator-routes"],
    queryFn: async () => getOperatorRoutes(accessToken)
  });
  const myRoutes = routesQuery.data?.routes ?? [];

  const acceptMutation = useMutation({
    mutationFn: (routeId: string) => acceptOperatorRoute(routeId, accessToken),
    onSuccess: (data) => {
      queryClient.setQueryData(["operator-routes"], data);
    }
  });

  const availabilityQuery = useQuery({
    queryKey: ["operator-availability"],
    queryFn: async () => getOperatorAvailability(accessToken)
  });

  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (availabilityQuery.data) {
      setSelectedDays(new Set(availabilityQuery.data.dates));
    }
  }, [availabilityQuery.data]);

  const saveAvailability = useMutation({
    mutationFn: () => setOperatorAvailability([...selectedDays], accessToken),
    onSuccess: (data) => {
      queryClient.setQueryData(["operator-availability"], data);
    }
  });

  const invalidateQueue = () => queryClient.invalidateQueries({ queryKey: ["operator-queue"] });
  const completeMutation = useMutation({
    mutationFn: (jobId: string) => updateOperatorJobStatus(jobId, { status: "COMPLETED" }, accessToken),
    onSuccess: invalidateQueue
  });
  const claimMutation = useMutation({
    mutationFn: (jobId: string) => claimOperatorJob(jobId, accessToken),
    onSuccess: invalidateQueue
  });

  const jobs = queueQuery.data?.jobs ?? [];

  const availabilityDirty = useMemo(() => {
    const saved = new Set(availabilityQuery.data?.dates ?? []);
    if (saved.size !== selectedDays.size) return true;
    for (const d of selectedDays) if (!saved.has(d)) return true;
    return false;
  }, [availabilityQuery.data, selectedDays]);

  function toggleDay(key: string): void {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function jobActions(job: OperatorQueueJob): JSX.Element {
    if (job.status !== "SCHEDULED") {
      return (
        <span className={`coverage-badge ${job.status === "COMPLETED" ? "covered" : "uncovered"}`}>
          {job.status}
        </span>
      );
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
      </div>
    );
  }

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <h2>Operator Dashboard</h2>
        <p className="subtext">Signed in as {user.name}. Manage your availability and today's route.</p>
      </div>

      <article className="panel">
        <div className="panel-head-row">
          <h3>My availability</h3>
          {availabilityDirty ? (
            <button
              type="button"
              className="add-day-btn"
              onClick={() => saveAvailability.mutate()}
              disabled={saveAvailability.isPending}
            >
              {saveAvailability.isPending ? "Saving…" : "Save availability"}
            </button>
          ) : null}
        </div>
        <p className="subtext">Tap the days over the next 30 you're available to run routes.</p>
        {availabilityQuery.isLoading ? (
          <p className="subtext">Loading…</p>
        ) : (
          <div className="availability-grid">
            {NEXT_30_DAYS.map((d) => {
              const key = dayKey(d);
              const on = selectedDays.has(key);
              return (
                <button
                  type="button"
                  key={key}
                  className={`availability-day${on ? " is-on" : ""}`}
                  onClick={() => toggleDay(key)}
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
        )}
        {saveAvailability.isSuccess && !availabilityDirty ? (
          <p className="success-inline">Availability saved.</p>
        ) : null}
        {saveAvailability.isError ? <p className="error">{getErrorMessage(saveAvailability.error)}</p> : null}
      </article>

      <article className="panel">
        <h3>My routes today</h3>
        <p className="subtext">
          Accept a route to lock it to you. Once accepted, its stops can't be reassigned.
        </p>
        {routesQuery.isLoading ? (
          <p className="subtext">Loading…</p>
        ) : myRoutes.length === 0 ? (
          <p className="subtext">No routes assigned to you today yet. An admin assigns routes each day.</p>
        ) : (
          <ul className="operator-route-list">
            {myRoutes.map((route) => {
              const accepted = route.status === "ACCEPTED";
              return (
                <li className={`operator-route${accepted ? " is-accepted" : ""}`} key={route.id}>
                  <div className="operator-route-head">
                    <div>
                      <strong>{route.label ?? "Route"}</strong>
                      <span className="admin-table-sub">
                        {route.stops.length} stop{route.stops.length === 1 ? "" : "s"} ·{" "}
                        {formatMiles(route.totalDistanceMeters)} · {formatDuration(route.totalDurationSeconds)}
                      </span>
                    </div>
                    <span className={`coverage-badge ${accepted ? "covered" : "uncovered"}`}>
                      {accepted ? "✓ Accepted" : "Assigned"}
                    </span>
                  </div>
                  <ol className="route-stop-list">
                    {route.stops.map((stop) => (
                      <li className="route-stop" key={stop.addressId}>
                        <span className="route-stop-num">{stop.order + 1}</span>
                        <div>
                          <strong>{stop.line1}</strong>
                          <span className="admin-table-sub">
                            {stop.city}, {stop.state} {stop.postalCode} · {stop.customerName}
                          </span>
                          <span className="admin-table-sub">
                            {stop.jobTypes
                              .map((t) => (t === "CURB_OUT" ? "Roll-out" : "Roll-in"))
                              .join(" + ")}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <div className="button-row">
                    <a
                      className="cta-secondary"
                      href={routeMapsUrl(route)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open in Maps
                    </a>
                    {accepted ? (
                      <span className="operator-route-lock">🔒 Locked to you</span>
                    ) : (
                      <button
                        type="button"
                        className="cta-primary"
                        onClick={() => acceptMutation.mutate(route.id)}
                        disabled={acceptMutation.isPending}
                      >
                        {acceptMutation.isPending ? "Accepting…" : "Accept route"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {routesQuery.isError ? <p className="error">{getErrorMessage(routesQuery.error)}</p> : null}
        {acceptMutation.isError ? <p className="error">{getErrorMessage(acceptMutation.error)}</p> : null}
      </article>

      <article className="panel">
        <h3>All upcoming jobs (7 days)</h3>
        {queueQuery.isLoading ? (
          <p className="subtext">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="subtext">No jobs scheduled in the next 7 days.</p>
        ) : (
          <ul className="op-job-list">
            {jobs.map((job) => (
              <li className="op-job" key={job.id}>
                <div className="op-job-main">
                  <strong>{job.addressLine1}</strong>
                  <span className="admin-table-sub">
                    {job.city}, {job.state} · {new Date(job.scheduledDate).toLocaleString()} ·{" "}
                    {job.type === "CURB_OUT" ? "Roll-out" : "Roll-in"}
                  </span>
                </div>
                {jobActions(job)}
              </li>
            ))}
          </ul>
        )}
        {(queueQuery.error || claimMutation.error || completeMutation.error) ? (
          <p className="error">
            {getErrorMessage(queueQuery.error ?? claimMutation.error ?? completeMutation.error)}
          </p>
        ) : null}
      </article>
    </div>
  );
}
