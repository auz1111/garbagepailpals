import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AdminRouteResponse } from "@gpp/shared";
import { getTodaysRoute } from "../lib/api";

type TodaysRouteProps = {
  accessToken: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

// Decode an OpenRouteService / Google encoded polyline (precision 5) to [lat,lng] pairs.
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
  if (mins < 60) {
    return `${mins} min`;
  }
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatMiles(meters: number): string {
  return `${(meters / 1609.34).toFixed(1)} mi`;
}

// Build a Google Maps directions deep link with the optimized stops in order.
function googleMapsUrl(route: AdminRouteResponse): string {
  const points = [
    `${route.start.lat},${route.start.lng}`,
    ...route.stops.map((stop) => `${stop.lat},${stop.lng}`),
    `${route.end.lat},${route.end.lng}`
  ];
  return `https://www.google.com/maps/dir/${points.map(encodeURIComponent).join("/")}`;
}

function RouteMap({ route }: { route: AdminRouteResponse }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }
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
    if (!map || !layer) {
      return;
    }
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
    bounds.push([route.start.lat, route.start.lng]);

    route.stops.forEach((stop) => {
      L.marker([stop.lat, stop.lng], { icon: pin(String(stop.order + 1), "#055a5f") })
        .bindPopup(`<strong>${stop.order + 1}. ${stop.line1}</strong><br>${stop.city}, ${stop.state}`)
        .addTo(layer);
      bounds.push([stop.lat, stop.lng]);
    });

    L.marker([route.end.lat, route.end.lng], { icon: pin("B", "#f7a81b") })
      .bindPopup(`<strong>End</strong><br>${route.end.label}`)
      .addTo(layer);
    bounds.push([route.end.lat, route.end.lng]);

    if (route.geometry) {
      L.polyline(decodePolyline(route.geometry), { color: "#34a6ab", weight: 4 }).addTo(layer);
    } else if (bounds.length > 1) {
      L.polyline(bounds, { color: "#34a6ab", weight: 3, dashArray: "6 6" }).addTo(layer);
    }

    if (bounds.length > 0) {
      // Fit to the tightest zoom that still shows the whole route.
      map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24] });
    }
    // Recompute size in case the container just became visible.
    setTimeout(() => map.invalidateSize(), 0);
  }, [route]);

  return <div className="route-map" ref={containerRef} />;
}

// The planned route is cached in localStorage keyed by today's date, so it
// survives page refreshes and navigation. It's only discarded when the day
// rolls over (a new day's route must be created fresh).
const ROUTE_CACHE_KEY = "gpp.todaysRoute";
type CachedPlan = { date: string; start: string; end: string; response: AdminRouteResponse };

function localDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function loadCachedPlan(): CachedPlan | null {
  try {
    const raw = localStorage.getItem(ROUTE_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as CachedPlan;
    // Only reuse a plan that was created today.
    return parsed.date === localDateKey() ? parsed : null;
  } catch {
    return null;
  }
}

function saveCachedPlan(plan: Omit<CachedPlan, "date">): void {
  try {
    localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify({ date: localDateKey(), ...plan }));
  } catch {
    // Ignore storage failures (private mode, quota) — cache is best-effort.
  }
}

export function TodaysRoute({ accessToken }: TodaysRouteProps): JSX.Element {
  const cached = loadCachedPlan();
  const [start, setStart] = useState(cached?.start ?? "");
  const [end, setEnd] = useState(cached?.end ?? "");
  const [route, setRoute] = useState<AdminRouteResponse | null>(cached?.response ?? null);

  const routeMutation = useMutation({
    mutationFn: () =>
      getTodaysRoute({ start: start.trim(), end: end.trim() ? end.trim() : undefined }, accessToken),
    onSuccess: (data) => {
      setRoute(data);
      saveCachedPlan({ start: start.trim(), end: end.trim(), response: data });
    }
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!start.trim()) {
      return;
    }
    routeMutation.mutate();
  }

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <h2>Today's Routes</h2>
        <p className="subtext">
          The best order to service every location scheduled for pickup today.
        </p>
      </div>

      <article className="panel">
        <form onSubmit={handleSubmit}>
          <div className="admin-filters">
            <label className="admin-filter-search">
              Start location
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
          <div className="detail-save-row">
            <button
              type="submit"
              className="cta-primary"
              disabled={!start.trim() || routeMutation.isPending}
            >
              {routeMutation.isPending ? "Planning…" : "Plan route"}
            </button>
          </div>
          {routeMutation.isError ? (
            <p className="error">{getErrorMessage(routeMutation.error)}</p>
          ) : null}
        </form>
      </article>

      {route ? (
        route.stops.length === 0 ? (
          <article className="panel">
            <p className="subtext">No locations are scheduled for pickup today.</p>
          </article>
        ) : (
          <>
            <article className="panel">
              <div className="route-summary">
                <div className="admin-stat">
                  <span className="admin-stat-label">Stops</span>
                  <strong>{route.stops.length}</strong>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">Drive time</span>
                  <strong>{formatDuration(route.totalDurationSeconds)}</strong>
                </div>
                <div className="admin-stat">
                  <span className="admin-stat-label">Distance</span>
                  <strong>{formatMiles(route.totalDistanceMeters)}</strong>
                </div>
                <a
                  className="cta-primary route-maps-link"
                  href={googleMapsUrl(route)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in Google Maps
                </a>
              </div>
            </article>

            <article className="panel">
              <RouteMap route={route} />
            </article>

            <article className="panel">
              <h3>Stops in order</h3>
              <ol className="route-stop-list">
                <li className="route-stop is-endpoint">
                  <span className="route-stop-num route-stop-start">A</span>
                  <div>
                    <strong>Start</strong>
                    <span className="admin-table-sub">{route.start.label}</span>
                  </div>
                </li>
                {route.stops.map((stop) => (
                  <li className="route-stop" key={stop.addressId}>
                    <span className="route-stop-num">{stop.order + 1}</span>
                    <div>
                      <strong>{stop.line1}</strong>
                      <span className="admin-table-sub">
                        {stop.city}, {stop.state} {stop.postalCode} · {stop.customerName}
                      </span>
                      <span className="admin-table-sub">
                        {stop.cans} can{stop.cans === 1 ? "" : "s"} ·{" "}
                        {stop.rollIn ? "roll-in" : "roll-out only"}
                        {stop.cadence === "BIWEEKLY" ? " · biweekly" : ""}
                      </span>
                    </div>
                  </li>
                ))}
                <li className="route-stop is-endpoint">
                  <span className="route-stop-num route-stop-end">B</span>
                  <div>
                    <strong>End</strong>
                    <span className="admin-table-sub">{route.end.label}</span>
                  </div>
                </li>
              </ol>
            </article>
          </>
        )
      ) : null}
    </div>
  );
}
