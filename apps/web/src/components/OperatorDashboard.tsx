import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CurrentUser, DailyRoute } from "@gpp/shared";
import {
  acceptOperatorRoute,
  getOperatorAvailability,
  getOperatorRoutes,
  setOperatorAvailability
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
      zoomControl: false,
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
      L.marker([s.lat, s.lng], { icon: pin(String(s.order + 1), color) }).addTo(layer);
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
                      {accepted ? "Assigned to You" : "Assigned to You — Awaiting Acceptance"}
                    </span>
                  </div>
                  <div className="operator-route-body">
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
                    {accepted ? (
                      <span className="operator-route-lock">🔒 Locked to you</span>
                    ) : (
                      <button
                        type="button"
                        className="cta-primary accept-route-btn"
                        onClick={() => acceptMutation.mutate(route.id)}
                        disabled={acceptMutation.isPending}
                      >
                        {acceptMutation.isPending ? "Accepting…" : "✓ Accept route"}
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
    </div>
  );
}
