import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DailyRoute, RouteHistoryResponse } from "@gpp/shared";
import { estimatedRouteMinutes, formatMinutes } from "@gpp/shared";
import { getRouteHistory, getZones } from "../lib/api";

type RouteHistoryProps = { accessToken: string };

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" }
];

const COLOR_SERVICED = "#16a34a";
const COLOR_STOP = "#055a5f";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

// Google encoded-polyline decoder (shared shape with the routing maps).
function decodePolyline(encoded: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

function formatMiles(meters: number): string {
  return `${(meters / 1609.34).toFixed(1)} mi`;
}

// Format a UTC-midnight service date without local-timezone day drift.
function formatDay(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    ...opts
  });
}

function formatStamp(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

const STATUS_META: Record<DailyRoute["status"], { cls: string; text: string }> = {
  COMPLETED: { cls: "is-done", text: "Completed" },
  CANCELLED: { cls: "is-cancelled", text: "Cancelled" },
  ACCEPTED: { cls: "is-accepted", text: "In progress" },
  ASSIGNED: { cls: "is-awaiting", text: "Awaiting accept" }
};

// A compact read-only map of a single historical route.
function HistoryRouteMap({ route }: { route: DailyRoute }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: false, attributionControl: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const pin = (label: string, fill: string) =>
      L.divIcon({
        className: "route-pin-wrap",
        html: `<span class="route-pin" style="background:${fill}">${label}</span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

    const lineColor = route.status === "CANCELLED" ? "#9ca3af" : COLOR_STOP;
    const path = route.geometry
      ? decodePolyline(route.geometry)
      : route.stops.map((s) => [s.lat, s.lng] as [number, number]);
    if (path.length > 1) {
      L.polyline(path, { color: lineColor, weight: 4, opacity: 0.85 }).addTo(layer);
    }

    const bounds: Array<[number, number]> = [];
    route.stops.forEach((s) => {
      const fill = s.servicedAt ? COLOR_SERVICED : COLOR_STOP;
      L.marker([s.lat, s.lng], { icon: pin(String(s.order + 1), fill) }).addTo(layer);
      bounds.push([s.lat, s.lng]);
    });
    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 17 });
    }
    setTimeout(() => map.invalidateSize(), 0);
  }, [route]);

  return <div className="history-route-map" ref={containerRef} />;
}

export function RouteHistory({ accessToken }: RouteHistoryProps): JSX.Element {
  const [rangeDays, setRangeDays] = useState(30);
  const [zoneId, setZoneId] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const zonesQuery = useQuery({ queryKey: ["zones"], queryFn: async () => getZones(accessToken) });
  const zones = zonesQuery.data?.zones ?? [];

  const historyQuery = useQuery({
    queryKey: ["route-history", rangeDays, zoneId],
    queryFn: async () => getRouteHistory(rangeDays, accessToken, zoneId || undefined)
  });

  const data: RouteHistoryResponse | undefined = historyQuery.data;
  const summary = data?.summary;
  const routes = data?.routes ?? [];

  const completionRate =
    summary && summary.stopsTotal > 0
      ? Math.round((summary.stopsServiced / summary.stopsTotal) * 100)
      : 0;
  const maxDayStops = summary ? Math.max(1, ...summary.byDay.map((d) => d.stopsTotal)) : 1;

  // Group routes by service day (already sorted newest-first by the API).
  const groups: Array<{ date: string; routes: DailyRoute[] }> = [];
  for (const r of routes) {
    const key = r.serviceDate.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.date === key) last.routes.push(r);
    else groups.push({ date: key, routes: [r] });
  }

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <h2>Route History</h2>
        <p className="subtext">
          Every route and serviced location over time. Pick a window, then expand a route to see
          exactly what happened.
        </p>
      </div>

      <div className="history-range">
        {RANGES.map((r) => (
          <button
            key={r.days}
            type="button"
            className={`history-range-btn${rangeDays === r.days ? " is-active" : ""}`}
            onClick={() => setRangeDays(r.days)}
          >
            Last {r.label}
          </button>
        ))}
      </div>

      {zones.length > 0 ? (
        <div className="history-range" role="tablist" aria-label="Service area">
          <button
            type="button"
            className={`history-range-btn${zoneId === "" ? " is-active" : ""}`}
            onClick={() => setZoneId("")}
          >
            All areas
          </button>
          {zones.map((z) => (
            <button
              key={z.id}
              type="button"
              className={`history-range-btn${zoneId === z.id ? " is-active" : ""}`}
              onClick={() => setZoneId(z.id)}
            >
              {z.name}
              {z.isTest ? <span className="zone-tab-test">Test</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {historyQuery.isLoading ? (
        <p className="subtext">Loading route history…</p>
      ) : historyQuery.isError ? (
        <p className="error">{getErrorMessage(historyQuery.error)}</p>
      ) : !summary || routes.length === 0 ? (
        <article className="panel">
          <p className="subtext">No routes in the last {rangeDays} days yet.</p>
        </article>
      ) : (
        <>
          <div className="history-stats">
            <div className="history-stat">
              <strong>{summary.totalRoutes}</strong>
              <span>Routes</span>
            </div>
            <div className="history-stat is-done">
              <strong>{summary.completed}</strong>
              <span>Completed</span>
            </div>
            <div className="history-stat is-progress">
              <strong>{summary.inProgress + summary.awaiting}</strong>
              <span>In flight</span>
            </div>
            <div className="history-stat is-cancelled">
              <strong>{summary.cancelled}</strong>
              <span>Cancelled</span>
            </div>
            <div className="history-stat is-serviced">
              <strong>
                {summary.stopsServiced}
                <span className="history-stat-sub">/{summary.stopsTotal}</span>
              </strong>
              <span>Stops serviced</span>
            </div>
            <div className="history-stat is-rate">
              <strong>{completionRate}%</strong>
              <span>Completion</span>
            </div>
          </div>

          <div className="history-grid">
            <article className="panel">
              <h3>Stops serviced per day</h3>
              <div className="history-chart">
                {summary.byDay.map((d) => {
                  const servicedPct = (d.stopsServiced / maxDayStops) * 100;
                  const restPct = ((d.stopsTotal - d.stopsServiced) / maxDayStops) * 100;
                  return (
                    <div className="history-bar-col" key={d.date} title={`${d.stopsServiced}/${d.stopsTotal} serviced · ${d.routes} route${d.routes === 1 ? "" : "s"}`}>
                      <div className="history-bar-track">
                        <div className="history-bar-rest" style={{ height: `${restPct}%` }} />
                        <div className="history-bar-serviced" style={{ height: `${servicedPct}%` }} />
                      </div>
                      <span className="history-bar-label">
                        {formatDay(d.date, { month: "numeric", day: "numeric" })}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="history-legend">
                <span>
                  <i className="history-dot is-serviced" /> Serviced
                </span>
                <span>
                  <i className="history-dot is-rest" /> Not serviced
                </span>
              </div>
            </article>

            <article className="panel">
              <h3>By operator</h3>
              <ul className="history-operators">
                {summary.byOperator.map((op) => {
                  const rate =
                    op.stopsTotal > 0 ? Math.round((op.stopsServiced / op.stopsTotal) * 100) : 0;
                  return (
                    <li className="history-operator" key={op.operatorId}>
                      <span className="history-operator-icon" aria-hidden="true">
                        👤
                      </span>
                      <div className="history-operator-body">
                        <div className="history-operator-top">
                          <strong>{op.operatorName}</strong>
                          <span className="admin-table-sub">
                            {op.routes} route{op.routes === 1 ? "" : "s"} · {op.stopsServiced}/
                            {op.stopsTotal} serviced
                          </span>
                        </div>
                        <div className="history-operator-bar">
                          <div className="history-operator-fill" style={{ width: `${rate}%` }} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </article>
          </div>

          <article className="panel">
            <h3>Routes</h3>
            {groups.map((group) => (
              <div className="history-day" key={group.date}>
                <div className="history-day-head">
                  {formatDay(group.date, { weekday: "long", month: "long", day: "numeric" })}
                  <span className="history-day-count">
                    {group.routes.length} route{group.routes.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="history-route-list">
                  {group.routes.map((r) => {
                    const open = expanded === r.id;
                    const serviced = r.stops.filter((s) => s.servicedAt).length;
                    const total = r.stops.length;
                    const meta = STATUS_META[r.status];
                    return (
                      <li className={`history-route ${meta.cls}`} key={r.id}>
                        <button
                          type="button"
                          className="history-route-head"
                          aria-expanded={open}
                          onClick={() => setExpanded(open ? null : r.id)}
                        >
                          <span className="history-route-chevron">{open ? "▾" : "▸"}</span>
                          <strong>{r.operatorName}</strong>
                          {r.label ? <span className="history-route-label">{r.label}</span> : null}
                          <span className="history-route-meta">
                            {serviced}/{total} serviced · {formatMiles(r.totalDistanceMeters)} · ~
                            {formatMinutes(estimatedRouteMinutes(r))}
                          </span>
                          <span className={`coverage-badge ${meta.cls === "is-cancelled" || meta.cls === "is-awaiting" ? "uncovered" : "covered"}`}>
                            {meta.text}
                          </span>
                        </button>
                        {open ? (
                          <div className="history-route-detail">
                            <div className="history-route-facts">
                              {formatStamp(r.acceptedAt) ? (
                                <span>Accepted {formatStamp(r.acceptedAt)}</span>
                              ) : null}
                              {formatStamp(r.cancelledAt) ? (
                                <span>Cancelled {formatStamp(r.cancelledAt)}</span>
                              ) : null}
                              {r.cancelReason ? (
                                <span className="history-route-reason">Reason: {r.cancelReason}</span>
                              ) : null}
                            </div>
                            <div className="history-route-body">
                              <ol className="route-stop-list">
                                {r.stops.map((stop) => (
                                  <li
                                    className={`route-stop${stop.servicedAt ? " is-serviced" : ""}`}
                                    key={stop.addressId}
                                  >
                                    <span className="route-stop-num">{stop.order + 1}</span>
                                    <div>
                                      <strong>{stop.line1}</strong>
                                      <span className="admin-table-sub">
                                        {stop.city}, {stop.state} {stop.postalCode} ·{" "}
                                        {stop.customerName}
                                      </span>
                                      <span className="admin-table-sub">
                                        {stop.jobTypes
                                          .map((t) => (t === "CURB_OUT" ? "Roll-out" : "Roll-in"))
                                          .join(" + ")}{" "}
                                        · {stop.canCount} can{stop.canCount === 1 ? "" : "s"}
                                        {stop.servicedAt
                                          ? ` · ✓ serviced ${formatStamp(stop.servicedAt)}`
                                          : " · not serviced"}
                                      </span>
                                    </div>
                                  </li>
                                ))}
                              </ol>
                              {r.stops.length > 0 ? <HistoryRouteMap route={r} /> : null}
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </article>
        </>
      )}
    </div>
  );
}
