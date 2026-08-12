import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { estimatedRouteMinutes, formatMinutes } from "@gpp/shared";
import { getAssignedRoutes, getTodaysLocations } from "../lib/api";

type TodaysRoutesHeroProps = {
  accessToken: string;
};

const COLOR_UNASSIGNED = "#9aa5ad";
const COLOR_AWAITING = "#f7a81b";
const COLOR_ACCEPTED = "#22c55e";

// Non-interactive map used purely as the hero backdrop.
function HeroMap({
  points
}: {
  points: Array<{ lat: number; lng: number; color: string }>;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false
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
    const bounds: Array<[number, number]> = [];
    points.forEach((p) => {
      L.circleMarker([p.lat, p.lng], {
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: p.color,
        fillOpacity: 1
      }).addTo(layer);
      bounds.push([p.lat, p.lng]);
    });
    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 16 });
    } else {
      map.setView([44.058, -121.315], 12); // Bend, OR fallback
    }
    setTimeout(() => map.invalidateSize(), 0);
  }, [points]);

  return <div className="routes-hero-map" ref={containerRef} aria-hidden="true" />;
}

export function TodaysRoutesHero({ accessToken }: TodaysRoutesHeroProps): JSX.Element {
  const routesQuery = useQuery({
    queryKey: ["assigned-routes"],
    queryFn: async () => getAssignedRoutes(accessToken)
  });
  const locationsQuery = useQuery({
    queryKey: ["today-locations"],
    queryFn: async () => getTodaysLocations(undefined, accessToken)
  });

  const routes = routesQuery.data?.routes ?? [];
  const locations = locationsQuery.data?.locations ?? [];

  const total = locations.length;
  const done = locations.filter(
    (l) => l.routeStatus === "COMPLETED" || l.routeStatus === "CANCELLED"
  ).length;
  const accepted = locations.filter((l) => l.routeStatus === "ACCEPTED").length;
  const awaiting = locations.filter((l) => l.routeStatus === "ASSIGNED").length;
  const unassigned = locations.filter((l) => !l.assigned).length;

  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  const points = locations.map((l) => ({
    lat: l.lat,
    lng: l.lng,
    color:
      l.routeStatus === "COMPLETED" || l.routeStatus === "CANCELLED"
        ? COLOR_ACCEPTED
        : l.routeStatus === "ACCEPTED"
          ? COLOR_ACCEPTED
          : l.routeStatus === "ASSIGNED"
            ? COLOR_AWAITING
            : COLOR_UNASSIGNED
  }));

  const loading = routesQuery.isLoading || locationsQuery.isLoading;
  const summary =
    total === 0
      ? "No roll-outs or roll-ins are due today."
      : `${done} serviced · ${accepted} in progress · ${awaiting} awaiting acceptance · ${unassigned} unassigned across ${total} location${total === 1 ? "" : "s"}.`;

  return (
    <article className="routes-hero">
      <HeroMap points={points} />
      <div className="routes-hero-scrim" />
      <div className="routes-hero-overlay">
        <div className="routes-hero-head">
          <div>
            <span className="routes-hero-eyebrow">Today · {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>
            <h2>Today's Routes</h2>
            <p className="routes-hero-sub">{loading ? "Loading today's routes…" : summary}</p>
          </div>
          <Link to="/admin/routes" className="routes-hero-cta">
            View today's routes →
          </Link>
        </div>

        <div className="routes-hero-stats">
          <div className="rh-stat">
            <strong>{total}</strong>
            <span>Locations</span>
          </div>
          <div className="rh-stat is-done">
            <strong>{done}</strong>
            <span>Serviced</span>
          </div>
          <div className="rh-stat is-accepted">
            <strong>{accepted}</strong>
            <span>In progress</span>
          </div>
          <div className="rh-stat is-awaiting">
            <strong>{awaiting}</strong>
            <span>Awaiting</span>
          </div>
          <div className="rh-stat is-unassigned">
            <strong>{unassigned}</strong>
            <span>Unassigned</span>
          </div>
        </div>

        {total > 0 ? (
          <div className="rh-progress" role="img" aria-label={summary}>
            <div className="rh-progress-seg done" style={{ width: `${pct(done)}%` }} />
            <div className="rh-progress-seg accepted" style={{ width: `${pct(accepted)}%` }} />
            <div className="rh-progress-seg awaiting" style={{ width: `${pct(awaiting)}%` }} />
          </div>
        ) : null}

        <div className="rh-routes">
          {routes.length === 0 ? (
            <p className="rh-empty">No routes assigned yet — head to Today's Routes to assign operators.</p>
          ) : (
            routes.map((r) => {
              const servicedCount = r.stops.filter((s) => s.servicedAt !== null).length;
              const totalStops = r.stops.length;
              const statusClass =
                r.status === "CANCELLED"
                  ? "cancelled"
                  : r.status === "COMPLETED"
                    ? "done"
                    : r.status === "ACCEPTED"
                      ? "accepted"
                      : "awaiting";
              const statusLabel =
                r.status === "CANCELLED"
                  ? "Cancelled"
                  : r.status === "COMPLETED"
                    ? "Completed"
                    : r.status === "ACCEPTED"
                      ? "Accepted"
                      : "Awaiting";
              // Awaiting routes have no serviced work yet; show a hint of progress
              // so the bar reads as "started" rather than empty.
              const fillPct =
                r.status === "CANCELLED"
                  ? 100
                  : totalStops > 0
                    ? Math.max(r.status === "ASSIGNED" ? 8 : 0, (servicedCount / totalStops) * 100)
                    : 0;
              return (
                <div className="rh-route" key={r.id}>
                  <div className="rh-route-top">
                    <strong>{r.operatorName}</strong>
                    <span className="rh-route-meta">
                      {r.label ? `${r.label} · ` : ""}
                      {servicedCount}/{totalStops} serviced · ~
                      {formatMinutes(estimatedRouteMinutes(r))}
                    </span>
                    <span className={`rh-route-pill ${statusClass}`}>{statusLabel}</span>
                  </div>
                  <div className="rh-route-bar">
                    <div
                      className={`rh-route-fill ${statusClass}`}
                      style={{ width: `${fillPct}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </article>
  );
}
