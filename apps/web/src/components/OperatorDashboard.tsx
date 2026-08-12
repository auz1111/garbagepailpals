import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CurrentUser, DailyRoute, TimeOffStatus } from "@gpp/shared";
import { estimatedRouteMinutes, formatMinutes } from "@gpp/shared";
import {
  acceptOperatorRoute,
  getOperatorRoutes,
  getOperatorTimeOff,
  getOperatorZones,
  markStopServiced,
  requestOperatorTimeOff,
  setOperatorZones
} from "../lib/api";

// Decode an ORS/Google encoded polyline (precision 5) to [lat, lng] pairs.
function decodePolyline(encoded: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

// A small read-only map of one route: numbered stops, optional start/end pins,
// and the driving polyline.
function RouteMiniMap({ route }: { route: DailyRoute }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      zoomControl: true,
      attributionControl: false
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const pin = (label: string, color: string) =>
      L.divIcon({
        className: "route-pin-wrap",
        html: `<span class="route-pin" style="background:${color}">${label}</span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

    const bounds: Array<[number, number]> = [];
    const color = "#055a5f";

    if (route.geometry) {
      L.polyline(decodePolyline(route.geometry), { color, weight: 4 }).addTo(layer);
    }
    if (route.start) {
      L.marker([route.start.lat, route.start.lng], { icon: pin("A", "#043e42") }).addTo(layer);
      bounds.push([route.start.lat, route.start.lng]);
    }
    if (route.end) {
      L.marker([route.end.lat, route.end.lng], { icon: pin("B", "#b5750a") }).addTo(layer);
      bounds.push([route.end.lat, route.end.lng]);
    }
    route.stops.forEach((s) => {
      // Serviced stops adopt the serviced-green so the map matches the list.
      const stopColor = s.servicedAt ? "#16a34a" : color;
      L.marker([s.lat, s.lng], { icon: pin(String(s.order + 1), stopColor) }).addTo(layer);
      bounds.push([s.lat, s.lng]);
    });

    if (bounds.length > 0) {
      // Zoom in as tightly as possible while still showing the whole route.
      // A small padding keeps pins off the very edge; maxZoom guards the
      // degenerate single-point case from zooming to the tile limit.
      map.fitBounds(L.latLngBounds(bounds), { padding: [12, 12], maxZoom: 18 });
    }
    setTimeout(() => map.invalidateSize(), 0);
  }, [route]);

  return <div className="route-mini-map" ref={containerRef} />;
}

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

  const serviceMutation = useMutation({
    mutationFn: ({ routeId, addressId, serviced }: { routeId: string; addressId: string; serviced: boolean }) =>
      markStopServiced(routeId, addressId, serviced, accessToken),
    onSuccess: (data) => {
      queryClient.setQueryData(["operator-routes"], data);
    }
  });

  const timeOffQuery = useQuery({
    queryKey: ["operator-timeoff"],
    queryFn: async () => getOperatorTimeOff(accessToken)
  });
  const timeOffByDate = new Map<string, TimeOffStatus>(
    (timeOffQuery.data?.days ?? []).map((d) => [d.date, d.status])
  );

  const requestTimeOff = useMutation({
    mutationFn: (date: string) => requestOperatorTimeOff(date, accessToken),
    onSuccess: (data) => {
      queryClient.setQueryData(["operator-timeoff"], data);
    }
  });

  // The zones this operator serves. Only plain operators self-manage these;
  // pro-operators' zones are set by an admin.
  const canManageZones = user.role === "OPERATOR";
  const zonesQuery = useQuery({
    queryKey: ["operator-zones"],
    queryFn: async () => getOperatorZones(accessToken),
    enabled: canManageZones
  });
  const serveZones = zonesQuery.data?.zones ?? [];
  const zonesMutation = useMutation({
    mutationFn: (zoneIds: string[]) => setOperatorZones(zoneIds, accessToken),
    onSuccess: (data) => queryClient.setQueryData(["operator-zones"], data)
  });
  const toggleServeZone = (id: string, currentlyServes: boolean) => {
    const current = serveZones.filter((z) => z.serves).map((z) => z.id);
    const next = currentlyServes ? current.filter((x) => x !== id) : [...current, id];
    zonesMutation.mutate(next);
  };

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <h2>Operator Dashboard</h2>
        <p className="subtext">Signed in as {user.name}. Request time off and run today's routes.</p>
      </div>

      <article className="panel">
        <h3>My schedule</h3>
        <p className="subtext">
          You're available by default. Tap a day to request it off — an admin approves time off. Tap a
          pending request again to cancel it.
        </p>
        {timeOffQuery.isLoading ? (
          <p className="subtext">Loading…</p>
        ) : (
          <div className="availability-grid">
            {NEXT_30_DAYS.map((d) => {
              const key = dayKey(d);
              const status = timeOffByDate.get(key);
              const cls =
                status === "APPROVED"
                  ? " is-off-approved"
                  : status === "PENDING"
                    ? " is-off-pending"
                    : status === "DENIED"
                      ? " is-off-denied"
                      : "";
              const title =
                status === "APPROVED"
                  ? "Approved day off — tap to ask an admin to change"
                  : status === "PENDING"
                    ? "Requested off (awaiting approval) — tap to cancel"
                    : status === "DENIED"
                      ? "Request denied — tap to request again"
                      : "Available — tap to request off";
              return (
                <button
                  type="button"
                  key={key}
                  className={`availability-day${cls}`}
                  title={title}
                  onClick={() => requestTimeOff.mutate(key)}
                  disabled={requestTimeOff.isPending}
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
        <div className="map-legend timeoff-legend">
          <span>
            <span className="legend-dot legend-available" /> Available
          </span>
          <span>
            <span className="legend-dot legend-pending" /> Requested off
          </span>
          <span>
            <span className="legend-dot legend-approved" /> Approved off
          </span>
        </div>
        {requestTimeOff.isError ? <p className="error">{getErrorMessage(requestTimeOff.error)}</p> : null}
      </article>

      {canManageZones ? (
        <article className="panel">
          <h3>Areas I serve</h3>
          <p className="subtext">
            You're only offered routes in the areas you serve. Leave all unchecked to be available
            everywhere.
          </p>
          {zonesQuery.isLoading ? (
            <p className="subtext">Loading…</p>
          ) : serveZones.length === 0 ? (
            <p className="subtext">No service areas exist yet.</p>
          ) : (
            <ul className="serve-zone-list">
              {serveZones.map((z) => (
                <li className={`serve-zone${z.serves ? " is-on" : ""}`} key={z.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={z.serves}
                      disabled={zonesMutation.isPending}
                      onChange={() => toggleServeZone(z.id, z.serves)}
                    />
                    <span className="serve-zone-name">{z.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {zonesMutation.isError ? (
            <p className="error">{getErrorMessage(zonesMutation.error)}</p>
          ) : null}
        </article>
      ) : null}

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
              const total = route.stops.length;
              const servicedCount = route.stops.filter((s) => s.servicedAt).length;
              const isAssigned = route.status === "ASSIGNED";
              const isAccepted = route.status === "ACCEPTED";
              const isCompleted = route.status === "COMPLETED";
              const isCancelled = route.status === "CANCELLED";
              const canService = isAccepted || isCompleted;
              const badge = isCompleted
                ? { cls: "covered", text: "Completed ✓" }
                : isCancelled
                  ? { cls: "uncovered", text: "Cancelled by dispatch" }
                  : isAccepted
                    ? { cls: "covered", text: "Assigned to You" }
                    : { cls: "uncovered", text: "Assigned to You — Awaiting Acceptance" };
              return (
                <li
                  className={`operator-route${
                    isCompleted ? " is-complete" : isAccepted ? " is-accepted" : ""
                  }${isCancelled ? " is-cancelled" : ""}`}
                  key={route.id}
                >
                  <div className="operator-route-head">
                    <div>
                      <strong>{route.label ?? "Route"}</strong>
                      <span className="admin-table-sub">
                        {total} stop{total === 1 ? "" : "s"} · {formatMiles(route.totalDistanceMeters)} · ~
                        {formatMinutes(estimatedRouteMinutes(route))} to complete
                      </span>
                    </div>
                    <span className={`coverage-badge ${badge.cls}`}>{badge.text}</span>
                  </div>

                  {canService && total > 0 ? (
                    <div className="route-progress">
                      <div className="route-progress-bar">
                        <div
                          className="route-progress-fill"
                          style={{ width: `${(servicedCount / total) * 100}%` }}
                        />
                      </div>
                      <span className="admin-table-sub">
                        {servicedCount} of {total} serviced
                      </span>
                    </div>
                  ) : null}

                  <div className="operator-route-body">
                    <ol className="route-stop-list">
                      {route.stops.map((stop) => {
                        const done = Boolean(stop.servicedAt);
                        return (
                          <li className={`route-stop${done ? " is-serviced" : ""}`} key={stop.addressId}>
                            <span className="route-stop-num">{stop.order + 1}</span>
                            <div>
                              <strong>{stop.line1}</strong>
                              <span className="admin-table-sub">
                                {stop.city}, {stop.state} {stop.postalCode} · {stop.customerName}
                              </span>
                              <span className="admin-table-sub">
                                {stop.jobTypes
                                  .map((t) => (t === "CURB_OUT" ? "Roll-out" : "Roll-in"))
                                  .join(" + ")}{" "}
                                · {stop.canCount} can{stop.canCount === 1 ? "" : "s"}
                              </span>
                            </div>
                            {canService ? (
                              <button
                                type="button"
                                className={`stop-service-btn${done ? " is-done" : ""}`}
                                disabled={serviceMutation.isPending}
                                onClick={() =>
                                  serviceMutation.mutate({
                                    routeId: route.id,
                                    addressId: stop.addressId,
                                    serviced: !done
                                  })
                                }
                              >
                                {done ? "✓ Serviced" : "Mark serviced"}
                              </button>
                            ) : done ? (
                              <span className="stop-service-tag">✓ Serviced</span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                    <RouteMiniMap route={route} />
                  </div>

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
                      <button
                        type="button"
                        className="cta-primary accept-route-btn"
                        onClick={() => acceptMutation.mutate(route.id)}
                        disabled={acceptMutation.isPending}
                      >
                        {acceptMutation.isPending ? "Accepting…" : "✓ Accept route"}
                      </button>
                    ) : isCompleted ? (
                      <span className="operator-route-lock is-complete">✓ Route complete</span>
                    ) : isCancelled ? (
                      <span className="operator-route-lock">Dispatch pulled this route</span>
                    ) : (
                      <span className="operator-route-lock">🔒 Locked to you</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {routesQuery.isError ? <p className="error">{getErrorMessage(routesQuery.error)}</p> : null}
        {acceptMutation.isError ? <p className="error">{getErrorMessage(acceptMutation.error)}</p> : null}
        {serviceMutation.isError ? <p className="error">{getErrorMessage(serviceMutation.error)}</p> : null}
      </article>
    </div>
  );
}
