import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AdminRouteResponse, AdminRouteLeg } from "@gpp/shared";
import { getAssignedRoutes, getAvailableOperators, getTodaysRoute } from "../lib/api";

type TodaysRouteProps = {
  accessToken: string;
};

const LEG_COLORS = ["#055a5f", "#f7a81b", "#7b2ff7", "#e5484d", "#2b8a3e", "#1071e5", "#d6336c", "#f76707"];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function localDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Cache the last plan in localStorage keyed by today's date so it survives
// refreshes and navigation; discarded when the day rolls over.
const ROUTE_CACHE_KEY = "gpp.todaysRoute";
type CachedPlan = { date: string; start: string; end: string; response: AdminRouteResponse };

function loadCachedPlan(): CachedPlan | null {
  try {
    const raw = localStorage.getItem(ROUTE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPlan;
    return parsed.date === localDateKey() ? parsed : null;
  } catch {
    return null;
  }
}

function saveCachedPlan(plan: Omit<CachedPlan, "date">): void {
  try {
    localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify({ date: localDateKey(), ...plan }));
  } catch {
    /* best-effort */
  }
}

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

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatMiles(meters: number): string {
  return `${(meters / 1609.34).toFixed(1)} mi`;
}

function legGoogleMapsUrl(route: AdminRouteResponse, leg: AdminRouteLeg): string {
  const points = [
    `${route.start.lat},${route.start.lng}`,
    ...leg.stops.map((s) => `${s.lat},${s.lng}`),
    `${route.end.lat},${route.end.lng}`
  ];
  return `https://www.google.com/maps/dir/${points.map(encodeURIComponent).join("/")}`;
}

function RouteMap({ route }: { route: AdminRouteResponse }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19
    }).addTo(map);
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
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

    const bounds: Array<[number, number]> = [];

    L.marker([route.start.lat, route.start.lng], { icon: pin("A", "#043e42") })
      .bindPopup(`<strong>Start</strong><br>${route.start.label}`)
      .addTo(layer);
    L.marker([route.end.lat, route.end.lng], { icon: pin("B", "#b5750a") })
      .bindPopup(`<strong>End</strong><br>${route.end.label}`)
      .addTo(layer);
    bounds.push([route.start.lat, route.start.lng], [route.end.lat, route.end.lng]);

    route.routes.forEach((leg, legIndex) => {
      const color = LEG_COLORS[legIndex % LEG_COLORS.length] ?? "#055a5f";
      leg.stops.forEach((stop) => {
        L.marker([stop.lat, stop.lng], { icon: pin(String(stop.order + 1), color) })
          .bindPopup(
            `<strong>${leg.operatorName ?? "Route"} · ${stop.order + 1}</strong><br>${stop.line1}, ${stop.city}`
          )
          .addTo(layer);
        bounds.push([stop.lat, stop.lng]);
      });
      if (leg.geometry) {
        L.polyline(decodePolyline(leg.geometry), { color, weight: 4 }).addTo(layer);
      }
    });

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24] });
    }
    setTimeout(() => map.invalidateSize(), 0);
  }, [route]);

  return <div className="route-map" ref={containerRef} />;
}

export function TodaysRoute({ accessToken }: TodaysRouteProps): JSX.Element {
  const cached = loadCachedPlan();
  const [start, setStart] = useState(cached?.start ?? "");
  const [end, setEnd] = useState(cached?.end ?? "");
  const [route, setRoute] = useState<AdminRouteResponse | null>(cached?.response ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedOperator, setExpandedOperator] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const operatorsQuery = useQuery({
    queryKey: ["available-operators", todayIso()],
    queryFn: async () => getAvailableOperators(todayIso(), accessToken)
  });
  const operators = operatorsQuery.data?.operators ?? [];

  const assignedQuery = useQuery({
    queryKey: ["assigned-routes"],
    queryFn: async () => getAssignedRoutes(accessToken)
  });
  const assignedRoutes = assignedQuery.data?.routes ?? [];

  const routeMutation = useMutation({
    mutationFn: () =>
      getTodaysRoute(
        {
          start: start.trim(),
          end: end.trim() ? end.trim() : undefined,
          operatorIds: [...selected]
        },
        accessToken
      ),
    onSuccess: (data) => {
      setRoute(data);
      saveCachedPlan({ start: start.trim(), end: end.trim(), response: data });
      void queryClient.invalidateQueries({ queryKey: ["assigned-routes"] });
    }
  });

  function toggleOperator(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!start.trim()) return;
    routeMutation.mutate();
  }

  const assigning = selected.size > 0;
  const totals = useMemo(() => {
    const r = route?.routes ?? [];
    return {
      stops: r.reduce((n, leg) => n + leg.stops.length, 0),
      distance: r.reduce((m, leg) => m + leg.totalDistanceMeters, 0),
      duration: r.reduce((s, leg) => s + leg.totalDurationSeconds, 0)
    };
  }, [route]);

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <h2>Today's Routes</h2>
        <p className="subtext">
          Pick the operators working today, then assign each an optimized route of today's pickups.
        </p>
      </div>

      <article className="panel">
        <h3>Assigned routes</h3>
        {assignedQuery.isLoading ? (
          <p className="subtext">Loading…</p>
        ) : assignedRoutes.length === 0 ? (
          <p className="subtext">No routes are assigned for today yet.</p>
        ) : (
          <ul className="assigned-route-list">
            {assignedRoutes.map((ar) => {
              const open = expandedOperator === ar.operatorId;
              return (
                <li className="assigned-route" key={ar.operatorId}>
                  <button
                    type="button"
                    className="assigned-route-head"
                    aria-expanded={open}
                    onClick={() => setExpandedOperator(open ? null : ar.operatorId)}
                  >
                    <span className="assigned-route-chevron">{open ? "▾" : "▸"}</span>
                    <strong>{ar.operatorName}</strong>
                    <span className="assigned-route-count">
                      {ar.stops.length} stop{ar.stops.length === 1 ? "" : "s"}
                    </span>
                  </button>
                  {open ? (
                    <ol className="route-stop-list assigned-route-detail">
                      {ar.stops.map((stop) => (
                        <li className="route-stop" key={stop.addressId}>
                          <span className="route-stop-num">{stop.order + 1}</span>
                          <div>
                            <strong>{stop.line1}</strong>
                            <span className="admin-table-sub">
                              {stop.city}, {stop.state} {stop.postalCode} · {stop.customerName}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {assignedQuery.isError ? (
          <p className="error">{getErrorMessage(assignedQuery.error)}</p>
        ) : null}
      </article>

      <article className="panel">
        <form onSubmit={handleSubmit}>
          <div className="admin-filters">
            <label className="admin-filter-search">
              Start location (depot)
              <input
                value={start}
                onChange={(event) => setStart(event.target.value)}
                placeholder="e.g. 123 Depot Rd, Bend OR"
              />
            </label>
            <label className="admin-filter-search">
              End location <span className="route-optional">(optional — defaults to start)</span>
              <input
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                placeholder="Leave blank for a round trip"
              />
            </label>
          </div>

          <h4 className="form-section-title">Operators available today</h4>
          {operatorsQuery.isLoading ? (
            <p className="subtext">Loading operators…</p>
          ) : operators.length === 0 ? (
            <p className="subtext">
              No operators have marked themselves available today. You can still preview an
              unassigned route.
            </p>
          ) : (
            <div className="operator-picker">
              {operators.map((op) => (
                <label key={op.id} className="operator-choice">
                  <input
                    type="checkbox"
                    checked={selected.has(op.id)}
                    onChange={() => toggleOperator(op.id)}
                  />
                  <span>
                    <strong>{op.name}</strong>
                    <span className="admin-table-sub">{op.email}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="detail-save-row">
            <button type="submit" className="cta-primary" disabled={!start.trim() || routeMutation.isPending}>
              {routeMutation.isPending
                ? assigning
                  ? "Assigning…"
                  : "Planning…"
                : assigning
                  ? `Assign routes to ${selected.size} operator${selected.size === 1 ? "" : "s"}`
                  : "Preview route (no assignment)"}
            </button>
          </div>
          {routeMutation.isError ? <p className="error">{getErrorMessage(routeMutation.error)}</p> : null}
        </form>
      </article>

      {route ? (
        totals.stops === 0 ? (
          <article className="panel">
            <p className="subtext">No locations are scheduled for pickup today.</p>
          </article>
        ) : (
          <>
            <article className="panel">
              <div className="route-summary">
                <div className="admin-stat">
                  <span className="admin-stat-label">{route.assigned ? "Operators" : "Route"}</span>
                  <strong>{route.routes.length}</strong>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">Stops</span>
                  <strong>{totals.stops}</strong>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">Total drive time</span>
                  <strong>{formatDuration(totals.duration)}</strong>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">Total distance</span>
                  <strong>{formatMiles(totals.distance)}</strong>
                </div>
                {route.assigned ? (
                  <span className="coverage-badge covered">Assigned to operators</span>
                ) : null}
              </div>
            </article>

            <article className="panel">
              <RouteMap route={route} />
            </article>

            {route.routes.map((leg, legIndex) => (
              <article className="panel" key={leg.operatorId ?? `preview-${legIndex}`}>
                <div className="panel-head-row">
                  <h3>
                    <span
                      className="route-leg-dot"
                      style={{ background: LEG_COLORS[legIndex % LEG_COLORS.length] }}
                    />
                    {leg.operatorName ?? "Unassigned preview"}
                  </h3>
                  <a
                    className="cta-secondary"
                    href={legGoogleMapsUrl(route, leg)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in Maps
                  </a>
                </div>
                <p className="subtext">
                  {leg.stops.length} stop{leg.stops.length === 1 ? "" : "s"} ·{" "}
                  {formatMiles(leg.totalDistanceMeters)} · {formatDuration(leg.totalDurationSeconds)}
                </p>
                <ol className="route-stop-list">
                  {leg.stops.map((stop) => (
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
              </article>
            ))}
          </>
        )
      ) : null}
    </div>
  );
}
