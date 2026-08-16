import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DailyRoute, StopServiceVerificationItem } from "@gpp/shared";
import { SERVICE_REGISTRY, estimatedRouteMinutes, formatMinutes } from "@gpp/shared";
import { acceptOperatorRoute, declineOperatorRoute, markStopServiced } from "../lib/api";
import { RouteMiniMap, formatMiles, routeMapsUrl } from "./OperatorDashboard";
import { StopServiceVerification } from "./StopServiceVerification";
import { StopServicePhotos } from "./StopServicePhotos";
import { formatCans } from "./CanRowsEditor";

type Stop = DailyRoute["stops"][number];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Request failed";
}

// Compact, expandable list of today's routes for the PailPal dashboard. Each
// card is a two-line summary; expanding shows the map, and (once accepted) the
// stops with servicing. Accept/decline are on assigned routes.
export function DashboardRoutes({
  routes,
  accessToken
}: {
  routes: DailyRoute[];
  accessToken: string;
}): JSX.Element {
  return (
    <article className="panel">
      <h3>Today's routes</h3>
      <ul className="dash-route-list">
        {routes.map((r) => (
          <DashboardRouteCard key={r.id} route={r} accessToken={accessToken} />
        ))}
      </ul>
    </article>
  );
}

function DashboardRouteCard({
  route,
  accessToken
}: {
  route: DailyRoute;
  accessToken: string;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [verifyStop, setVerifyStop] = useState<Stop | null>(null);

  const setRoutes = (data: unknown): void => {
    queryClient.setQueryData(["operator-routes"], data);
  };

  const acceptM = useMutation({
    mutationFn: () => acceptOperatorRoute(route.id, accessToken),
    onSuccess: setRoutes
  });
  const declineM = useMutation({
    mutationFn: () => declineOperatorRoute(route.id, accessToken),
    onSuccess: (data) => {
      setRoutes(data);
      void queryClient.invalidateQueries({ queryKey: ["pailpal-today-summary"] });
    }
  });
  const serviceM = useMutation({
    mutationFn: (v: { addressId: string; serviced: boolean; verification?: StopServiceVerificationItem[] }) =>
      markStopServiced(route.id, v.addressId, v.serviced, accessToken, v.verification),
    onSuccess: (data) => {
      setRoutes(data);
      setVerifyStop(null);
    }
  });

  const total = route.stops.length;
  const serviced = route.stops.filter((s) => s.servicedAt).length;
  const isAssigned = route.status === "ASSIGNED";
  const isAccepted = route.status === "ACCEPTED";
  const isCompleted = route.status === "COMPLETED";
  const isCancelled = route.status === "CANCELLED";
  const canService = isAccepted || isCompleted;
  const badge = isCompleted
    ? { cls: "covered", text: "Completed ✓" }
    : isCancelled
      ? { cls: "uncovered", text: "Cancelled" }
      : isAccepted
        ? { cls: "covered", text: "On route" }
        : { cls: "uncovered", text: "Awaiting acceptance" };

  return (
    <li
      className={`dash-route-card${isAccepted ? " is-accepted" : ""}${isCompleted ? " is-complete" : ""}`}
    >
      <button
        type="button"
        className="dash-route-summary"
        onClick={() => setExpanded((x) => !x)}
        aria-expanded={expanded}
      >
        <span className="dash-route-lines">
          <span className="dash-route-title">
            <strong>{route.label ?? "Route"}</strong>
            <span className={`coverage-badge ${badge.cls}`}>{badge.text}</span>
          </span>
          <span className="admin-table-sub">
            {total} stop{total === 1 ? "" : "s"} · {formatMiles(route.totalDistanceMeters)} · ~
            {formatMinutes(estimatedRouteMinutes(route))}
            {canService && total > 0 ? ` · ${serviced}/${total} serviced` : ""}
          </span>
        </span>
        <span className="dash-route-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded ? (
        <div className="dash-route-detail">
          <RouteMiniMap route={route} />

          {canService && total > 0 ? (
            <ol className="route-stop-list">
              {route.stops.map((stop) => {
                const done = Boolean(stop.servicedAt);
                return (
                  <li className={`route-stop${done ? " is-serviced" : ""}`} key={stop.addressId}>
                    <span className="route-stop-num">{stop.order + 1}</span>
                    <div>
                      <strong>{stop.line1}</strong>
                      <span className="admin-table-sub">
                        {stop.city}, {stop.state} · {stop.customerName}
                      </span>
                      <span className="admin-table-sub">
                        {[
                          stop.jobTypes
                            .map((t) => (t === "CURB_OUT" ? "Roll-out" : "Roll-in"))
                            .join(" + "),
                          stop.cans.length > 0 ? formatCans(stop.cans) : null,
                          ...stop.services.map((s) => SERVICE_REGISTRY[s.type].label)
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <StopServicePhotos
                        verification={stop.serviceVerification}
                        accessToken={accessToken}
                      />
                    </div>
                    <button
                      type="button"
                      className={`stop-service-btn${done ? " is-done" : ""}`}
                      disabled={serviceM.isPending}
                      onClick={() => {
                        if (done) {
                          serviceM.mutate({ addressId: stop.addressId, serviced: false });
                        } else {
                          setVerifyStop(stop);
                        }
                      }}
                    >
                      {done ? "✓ Serviced — undo" : "Mark serviced"}
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : null}

          <div className="button-row">
            <a
              className="cta-secondary"
              href={routeMapsUrl(route)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Maps
            </a>
            {isAssigned ? (
              <>
                <button
                  type="button"
                  className="ghost-btn is-danger"
                  disabled={declineM.isPending || acceptM.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Decline this route? It will be removed and its stops freed for reassignment."
                      )
                    ) {
                      declineM.mutate();
                    }
                  }}
                >
                  {declineM.isPending ? "Declining…" : "Decline"}
                </button>
                <button
                  type="button"
                  className="cta-primary accept-route-btn"
                  disabled={acceptM.isPending || declineM.isPending}
                  onClick={() => acceptM.mutate()}
                >
                  {acceptM.isPending ? "Accepting…" : "✓ Accept route"}
                </button>
              </>
            ) : isCompleted ? (
              <span className="operator-route-lock is-complete">✓ Complete</span>
            ) : isCancelled ? (
              <span className="operator-route-lock">Cancelled by dispatch</span>
            ) : (
              <span className="operator-route-lock">🔒 Locked to you</span>
            )}
          </div>
          {acceptM.isError ? <p className="error">{errMsg(acceptM.error)}</p> : null}
          {declineM.isError ? <p className="error">{errMsg(declineM.error)}</p> : null}
          {serviceM.isError ? <p className="error">{errMsg(serviceM.error)}</p> : null}
        </div>
      ) : null}

      {verifyStop ? (
        <StopServiceVerification
          stop={verifyStop}
          accessToken={accessToken}
          saving={serviceM.isPending}
          error={serviceM.isError ? errMsg(serviceM.error) : null}
          onCancel={() => setVerifyStop(null)}
          onComplete={(verification) =>
            serviceM.mutate({ addressId: verifyStop.addressId, serviced: true, verification })
          }
        />
      ) : null}
    </li>
  );
}
