import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AdminTodaysLocation, DailyRoute } from "@gpp/shared";
import { estimatedRouteMinutes, formatMinutes } from "@gpp/shared";
import {
  cancelRoute,
  deleteRoute,
  getAssignedRoutes,
  getAvailableOperators,
  getNeighborhoods,
  getTodaysLocations,
  getTodaysRoute,
  getZones
} from "../lib/api";
import { formatCans } from "./CanRowsEditor";
import { DayStatusPanel } from "./DayStatusPanel";
import { StopServicePhotos } from "./StopServicePhotos";

type TodaysRouteProps = {
  accessToken: string;
};

// Pin colors for the serviceable-locations map, by assignment state.
const COLOR_UNASSIGNED = "#9aa5ad"; // gray — not on any route
const COLOR_AWAITING = "#f7a81b"; // gold — assigned, awaiting operator acceptance
const COLOR_ACCEPTED = "#055a5f"; // teal — accepted / locked
const COLOR_SERVICED = "#22c55e"; // green — serviced (completed/cancelled routes)

// Distinct line colors per assigned route (operator), avoiding the pin colors.
const ROUTE_COLORS = ["#7b2ff7", "#1071e5", "#e5484d", "#d6336c", "#f76707", "#2b8a3e", "#8250df", "#0891b2"];

// Decode an ORS/Google encoded polyline (precision 5) into [lat, lng] pairs.
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

function locationColor(loc: AdminTodaysLocation): string {
  // A serviced stop is green regardless of the route's overall status.
  if (loc.servicedAt) return COLOR_SERVICED;
  if (loc.routeStatus === "COMPLETED" || loc.routeStatus === "CANCELLED") return COLOR_SERVICED;
  if (loc.routeStatus === "ACCEPTED") return COLOR_ACCEPTED;
  if (loc.routeStatus === "ASSIGNED") return COLOR_AWAITING;
  return COLOR_UNASSIGNED;
}

function locationStatusLabel(loc: AdminTodaysLocation): string {
  if (loc.servicedAt) return "Serviced";
  if (loc.routeStatus === "COMPLETED") return "Serviced (route complete)";
  if (loc.routeStatus === "CANCELLED") return "Route cancelled";
  if (loc.routeStatus === "ACCEPTED") return "Accepted";
  if (loc.routeStatus === "ASSIGNED") return "Awaiting acceptance";
  return "Unassigned";
}

// What's due at this location today, in plain words.
function locationActionLabel(loc: AdminTodaysLocation): string {
  const out = loc.jobTypes.includes("CURB_OUT");
  const inn = loc.jobTypes.includes("CURB_IN");
  if (out && inn) return "Roll-out + Roll-in";
  if (inn) return "Roll-in";
  return "Roll-out";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type MapRoute = { id: string; color: string; geometry: string | null; stops: DailyRoute["stops"] };

// Read-only map of every serviceable location scheduled today. Pins are colored
// by assignment state; each assigned route's path is drawn in its operator color.
function LocationsMap({
  locations,
  routes
}: {
  locations: AdminTodaysLocation[];
  routes: MapRoute[];
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: false });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Popups render as raw HTML outside React Router, so a plain <a> would do a
    // full page reload. Intercept clicks on our popup links and route them
    // through the SPA router instead.
    map.on("popupopen", (e) => {
      const link = (e.popup.getElement() as HTMLElement | undefined)?.querySelector<HTMLAnchorElement>(
        "a.map-popup-link"
      );
      if (!link) return;
      link.onclick = (ev) => {
        ev.preventDefault();
        const to = link.getAttribute("data-to");
        if (to) navigate(to);
      };
    });
  }, [navigate]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const pin = (color: string) =>
      L.divIcon({
        className: "loc-pin-wrap",
        html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></span>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });

    const bounds: Array<[number, number]> = [];

    // Draw route lines first, so location pins sit on top of them.
    routes.forEach((route) => {
      const path = route.geometry
        ? decodePolyline(route.geometry)
        : route.stops.map((s) => [s.lat, s.lng] as [number, number]);
      if (path.length > 1) {
        L.polyline(path, { color: route.color, weight: 4, opacity: 0.85 }).addTo(layer);
      }
    });

    locations.forEach((loc) => {
      const href = `/admin/users/${loc.userId}#address-${loc.addressId}`;
      L.marker([loc.lat, loc.lng], { icon: pin(locationColor(loc)) })
        .bindPopup(
          `<a class="map-popup-link" href="${href}" data-to="${href}"><strong>${loc.line1}</strong></a><br>${loc.city}, ${loc.state} ${loc.postalCode}<br>${loc.customerName}<br><b>${locationActionLabel(
            loc
          )}</b> · ${loc.canCount} can${loc.canCount === 1 ? "" : "s"} · ${locationStatusLabel(loc)}`
        )
        .addTo(layer);
      bounds.push([loc.lat, loc.lng]);
    });

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 17 });
    }
    setTimeout(() => map.invalidateSize(), 0);
  }, [locations, routes]);

  return <div className="route-map" ref={containerRef} />;
}

// A focused map of a single assigned route — its path plus numbered stops,
// serviced stops in green. Shown when an assigned-route card is expanded.
function RouteDetailMap({ route, color }: { route: DailyRoute; color: string }): JSX.Element {
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

    const path = route.geometry
      ? decodePolyline(route.geometry)
      : route.stops.map((s) => [s.lat, s.lng] as [number, number]);
    if (path.length > 1) {
      L.polyline(path, { color, weight: 4, opacity: 0.85 }).addTo(layer);
    }

    const bounds: Array<[number, number]> = [];
    route.stops.forEach((s) => {
      const fill = s.servicedAt ? COLOR_SERVICED : "#055a5f";
      L.marker([s.lat, s.lng], { icon: pin(String(s.order + 1), fill) }).addTo(layer);
      bounds.push([s.lat, s.lng]);
    });

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 17 });
    }
    setTimeout(() => map.invalidateSize(), 0);
  }, [route, color]);

  return <div className="assigned-route-map" ref={containerRef} />;
}

export function TodaysRoute({ accessToken }: TodaysRouteProps): JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedOperator, setExpandedOperator] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Zone (city/region) is the top scope. Super admins see all zones; pro
  // operators only the ones granted to them. Everything below is scoped to the
  // selected zone.
  const zonesQuery = useQuery({
    queryKey: ["zones"],
    queryFn: async () => getZones(accessToken)
  });
  const zones = zonesQuery.data?.zones ?? [];
  const [zoneId, setZoneId] = useState("");
  useEffect(() => {
    if (!zoneId && zones.length > 0) {
      setZoneId(zones[0]!.id);
    }
  }, [zones, zoneId]);
  const zoneScope = zoneId || undefined;

  const operatorsQuery = useQuery({
    queryKey: ["available-operators", todayIso(), zoneId],
    queryFn: async () => getAvailableOperators(todayIso(), accessToken, zoneScope)
  });
  const operators = operatorsQuery.data?.operators ?? [];

  const assignedQuery = useQuery({
    queryKey: ["assigned-routes", zoneId],
    queryFn: async () => getAssignedRoutes(accessToken, zoneScope)
  });
  const assignedRoutes = assignedQuery.data?.routes ?? [];
  // Stable color per assigned route, shared between the list and the map lines.
  const routeColorById = new Map<string, string>();
  assignedRoutes.forEach((r, i) =>
    routeColorById.set(r.id, ROUTE_COLORS[i % ROUTE_COLORS.length] ?? "#7b2ff7")
  );
  const mapRoutes = assignedRoutes
    .filter((r) => r.status !== "CANCELLED")
    .map((r) => ({
      id: r.id,
      color: routeColorById.get(r.id) as string,
      geometry: r.geometry,
      stops: r.stops
    }));

  const neighborhoodsQuery = useQuery({
    queryKey: ["neighborhoods"],
    queryFn: async () => getNeighborhoods(accessToken)
  });
  const allNeighborhoods = neighborhoodsQuery.data?.neighborhoods ?? [];
  // Only the neighborhoods in the selected zone are pickable.
  const neighborhoods = zoneId
    ? allNeighborhoods.filter((n) => n.zoneId === zoneId)
    : allNeighborhoods;
  const [neighborhoodId, setNeighborhoodId] = useState("");
  // Clear the neighborhood choice when it no longer belongs to the selected zone.
  useEffect(() => {
    if (neighborhoodId && !neighborhoods.some((n) => n.id === neighborhoodId)) {
      setNeighborhoodId("");
    }
  }, [neighborhoods, neighborhoodId]);
  const selectedHood = neighborhoods.find((n) => n.id === neighborhoodId) ?? null;

  // Every serviceable location scheduled today in the selected zone. Drives the
  // map, the assignable counts, and which neighborhoods are already fully
  // assigned — all from one fetch.
  const locationsQuery = useQuery({
    queryKey: ["today-locations", zoneId],
    queryFn: async () => getTodaysLocations(undefined, accessToken, zoneScope)
  });
  const allLocations = locationsQuery.data?.locations ?? [];

  // Per-neighborhood today's-pickup counts, so a neighborhood whose pickups are
  // all already on a route can be disabled in the dropdown.
  const hoodStats = new Map<string, { total: number; unassigned: number }>();
  for (const loc of allLocations) {
    if (!loc.neighborhoodId) continue;
    const stat = hoodStats.get(loc.neighborhoodId) ?? { total: 0, unassigned: 0 };
    stat.total += 1;
    if (!loc.assigned) stat.unassigned += 1;
    hoodStats.set(loc.neighborhoodId, stat);
  }
  const isHoodFullyAssigned = (id: string): boolean => {
    const stat = hoodStats.get(id);
    return Boolean(stat && stat.total > 0 && stat.unassigned === 0);
  };

  // Locations in the selected scope (whole system or one neighborhood).
  const scopeLocations = neighborhoodId
    ? allLocations.filter((l) => l.neighborhoodId === neighborhoodId)
    : allLocations;
  // Serviced is counted per-stop and is mutually exclusive with the route-status
  // buckets below, so the legend totals match the pin colors on the map.
  const servicedCount = scopeLocations.filter(
    (l) => l.servicedAt || l.routeStatus === "COMPLETED" || l.routeStatus === "CANCELLED"
  ).length;
  const awaitingCount = scopeLocations.filter(
    (l) => !l.servicedAt && l.routeStatus === "ASSIGNED"
  ).length;
  const acceptedCount = scopeLocations.filter(
    (l) => !l.servicedAt && l.routeStatus === "ACCEPTED"
  ).length;
  const unassignedScope = scopeLocations.filter((l) => !l.assigned);
  const scopedUnassigned = unassignedScope.length;
  const nothingToAssign = scopedUnassigned === 0;
  const summaryReason = scopeLocations.length === 0 ? "none_scheduled" : "all_assigned";

  // Describe the unassigned work by action (roll-out / roll-in), not "pickups".
  const rollOutCount = unassignedScope.filter((l) => l.jobTypes.includes("CURB_OUT")).length;
  const rollInCount = unassignedScope.filter((l) => l.jobTypes.includes("CURB_IN")).length;
  const workPhrase = [
    rollOutCount ? `${rollOutCount} roll-out${rollOutCount === 1 ? "" : "s"}` : null,
    rollInCount ? `${rollInCount} roll-in${rollInCount === 1 ? "" : "s"}` : null
  ]
    .filter(Boolean)
    .join(" + ");

  const invalidateRouteViews = () => {
    void queryClient.invalidateQueries({ queryKey: ["today-locations"] });
    void queryClient.invalidateQueries({ queryKey: ["assigned-routes"] });
  };

  const deleteMutation = useMutation({
    mutationFn: (routeId: string) => deleteRoute(routeId, accessToken),
    onSuccess: () => invalidateRouteViews()
  });

  const cancelMutation = useMutation({
    mutationFn: ({ routeId, reason }: { routeId: string; reason?: string }) =>
      cancelRoute(routeId, reason, accessToken),
    onSuccess: () => invalidateRouteViews()
  });

  // Cancel keeps a record (route stays, marked Cancelled) with an optional
  // typed reason. Un-serviced stops are freed to reassign. `prompt` returns null
  // when the admin dismisses the dialog — treat that as "don't cancel".
  const promptAndCancel = (ar: DailyRoute) => {
    const reason = window.prompt(
      `Cancel ${ar.operatorName}'s route${ar.label ? ` (${ar.label})` : ""}?\n\n` +
        "Un-serviced stops are freed to reassign; any serviced stops stay recorded.\n" +
        "Optionally type a reason for the record (leave blank to skip):"
    );
    if (reason === null) return;
    cancelMutation.mutate({ routeId: ar.id, reason: reason.trim() || undefined });
  };

  const routeMutation = useMutation({
    mutationFn: () =>
      getTodaysRoute(
        {
          zoneId: zoneScope,
          neighborhoodId: neighborhoodId || undefined,
          operatorIds: [...selected]
        },
        accessToken
      ),
    onSuccess: () => {
      invalidateRouteViews();
      // Clean slate for the next assignment.
      setSelected(new Set());
      setNeighborhoodId("");
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
    routeMutation.mutate();
  }

  const assigning = selected.size > 0;
  const scope = selectedHood ? ` in ${selectedHood.name}` : "";
  const emptyMessage = `No roll-outs or roll-ins are due today${scope}.`;

  // When there's nothing left to assign, show the day's routing lifecycle as a
  // checklist so it's clear what's done and what's still in flight.
  const scopeTotal = scopeLocations.length;
  const awaitingAccept = scopeLocations.filter((l) => l.routeStatus === "ASSIGNED").length;
  const acceptedTotal = scopeLocations.filter(
    (l) => l.assigned && l.routeStatus !== "ASSIGNED"
  ).length;
  const routingSteps = [
    {
      label: "Today's roll-outs & roll-ins scheduled",
      detail: `${scopeTotal} location${scopeTotal === 1 ? "" : "s"}`,
      done: scopeTotal > 0
    },
    {
      label: "Every location assigned to a route",
      detail: `${scopeTotal - scopedUnassigned}/${scopeTotal} assigned`,
      done: scopedUnassigned === 0
    },
    {
      label: "Operators accepted their routes",
      detail: `${acceptedTotal}/${scopeTotal} accepted`,
      done: scopeTotal > 0 && awaitingAccept === 0
    },
    {
      label: "All stops serviced",
      detail: `${servicedCount}/${scopeTotal} serviced`,
      done: scopeTotal > 0 && servicedCount === scopeTotal
    }
  ];
  const dayComplete = scopeTotal > 0 && routingSteps.every((step) => step.done);

  // A live headline/subline that tracks where the day actually is, rather than a
  // static "fully assigned" message.
  const plural = scopeTotal === 1 ? "" : "s";
  const routingStatus = dayComplete
    ? {
        title: "Today's routes are all complete",
        sub: "Every roll-out and roll-in has been serviced."
      }
    : awaitingAccept === scopeTotal
      ? {
          title: "Assigned — waiting on operators to accept",
          sub: `All ${scopeTotal} location${plural} are on a route. No routes accepted yet.`
        }
      : awaitingAccept > 0
        ? {
            title: "Partly accepted — a few routes still pending",
            sub: `${acceptedTotal}/${scopeTotal} accepted · ${awaitingAccept} still awaiting operator acceptance.`
          }
        : servicedCount === 0
          ? {
              title: "Accepted — service hasn't started",
              sub: `All ${scopeTotal} location${plural} accepted. No stops serviced yet.`
            }
          : {
              title: "Service in progress",
              sub: `${servicedCount}/${scopeTotal} stops serviced — operators are out on their routes.`
            };

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <h2>Today's Routes</h2>
        <p className="subtext">
          Pick a service area, then assign operators an optimized route of that area's cart
          roll-outs (for tomorrow's pickups) and roll-ins (from yesterday's).
        </p>
      </div>

      {zonesQuery.isLoading ? null : zones.length === 0 ? (
        <article className="panel">
          <p className="subtext">
            No service areas yet. Add a neighborhood with a city (in Neighborhoods) to create a
            zone.
          </p>
        </article>
      ) : (
        <div className="zone-tabs" role="tablist" aria-label="Service area">
          {zones.map((z) => (
            <button
              key={z.id}
              type="button"
              role="tab"
              aria-selected={z.id === zoneId}
              className={`zone-tab${z.id === zoneId ? " is-active" : ""}`}
              onClick={() => setZoneId(z.id)}
            >
              <span className="zone-tab-name">
                {z.name}
                {z.isTest ? <span className="zone-tab-test">Test</span> : null}
              </span>
              <span className="zone-tab-count">
                {z.neighborhoodCount} neighborhood{z.neighborhoodCount === 1 ? "" : "s"}
              </span>
            </button>
          ))}
        </div>
      )}

      {zones.length > 0 && zoneId ? (
        <DayStatusPanel
          accessToken={accessToken}
          scope={{ zoneId: zoneScope, neighborhoodId: neighborhoodId || undefined }}
        />
      ) : null}

      {zones.length === 0 ? null : nothingToAssign ? (
        <article className="panel">
          {summaryReason === "all_assigned" ? (
            <div className="route-checklist">
              {dayComplete ? (
                <div className="route-day-done" role="status">
                  <span className="route-day-done-badge" aria-hidden="true">
                    ✓
                  </span>
                  <div className="route-day-done-text">
                    <strong>All routes complete for today{scope}!</strong>
                    <span>Every roll-out and roll-in has been serviced. Great work. 🎉</span>
                  </div>
                </div>
              ) : null}
              {!dayComplete ? (
                <div className="route-checklist-head">
                  <span className="route-checklist-title">
                    {routingStatus.title}
                    {scope}
                  </span>
                  <span className="route-checklist-sub">{routingStatus.sub}</span>
                </div>
              ) : null}
              <ol className="route-steps">
                {routingSteps.map((step, index) => (
                  <li key={step.label} className={`route-step${step.done ? " is-done" : ""}`}>
                    <span className="route-step-mark" aria-hidden="true">
                      {step.done ? "✓" : index + 1}
                    </span>
                    <span className="route-step-body">
                      <span className="route-step-label">{step.label}</span>
                      <span className="route-step-detail">{step.detail}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div className="route-notice">
              <span className="route-notice-icon" aria-hidden="true">
                🗓️
              </span>
              <span>{emptyMessage}</span>
            </div>
          )}
        </article>
      ) : null}

      {!nothingToAssign ? (
        <article className="panel assign-panel">
          <h3>Assign a route</h3>
        <form onSubmit={handleSubmit}>
          <ol className="assign-steps">
            <li className="assign-step">
              <div className="assign-step-head">
                <span className="assign-step-num">1</span>
                <div>
                  <strong>Choose an area</strong>
                  <span className="subtext">
                    Route all of today's roll-outs and roll-ins, or just one neighborhood.
                  </span>
                </div>
              </div>
              <select
                className="assign-select"
                value={neighborhoodId}
                onChange={(event) => setNeighborhoodId(event.target.value)}
              >
                <option value="">All locations ({allLocations.length})</option>
                {neighborhoods.map((n) => {
                  const fullyAssigned = isHoodFullyAssigned(n.id);
                  const todayCount = hoodStats.get(n.id)?.total ?? 0;
                  return (
                    <option key={n.id} value={n.id} disabled={fullyAssigned}>
                      {n.name} ({todayCount}){fullyAssigned ? " · assigned" : ""}
                    </option>
                  );
                })}
              </select>
              {selectedHood && selectedHood.locationCount === 0 ? (
                <p className="subtext route-hood-hint">
                  {selectedHood.name} has no locations assigned yet — add some on the Neighborhoods
                  page before assigning a route here.
                </p>
              ) : scopedUnassigned > 0 ? (
                <p className="assign-ready">
                  {workPhrase} ready to assign{scope}.
                </p>
              ) : null}
            </li>

            <li className="assign-step">
              <div className="assign-step-head">
                <span className="assign-step-num">2</span>
                <div>
                  <strong>Pick operator(s)</strong>
                  <span className="subtext">
                    One operator takes the whole route; pick several to split it into balanced
                    routes.
                  </span>
                </div>
              </div>
              {operatorsQuery.isLoading ? (
                <p className="subtext">Loading operators…</p>
              ) : operators.length === 0 ? (
                <p className="subtext">No operators have marked themselves available today.</p>
              ) : (
                <div className="operator-picker">
                  {operators.map((op) => {
                    const on = selected.has(op.id);
                    return (
                      <label key={op.id} className={`operator-choice${on ? " is-selected" : ""}`}>
                        <input type="checkbox" checked={on} onChange={() => toggleOperator(op.id)} />
                        <span>
                          <strong>{op.name}</strong>
                          <span className="admin-table-sub">{op.email}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </li>
          </ol>

          <div className="detail-save-row">
            <button
              type="submit"
              className="cta-primary"
              disabled={routeMutation.isPending || nothingToAssign || !assigning}
            >
              {routeMutation.isPending
                ? "Assigning…"
                : nothingToAssign
                  ? "Nothing to assign"
                  : !assigning
                    ? "Select an operator to assign"
                    : `Assign ${workPhrase} to ${selected.size} operator${selected.size === 1 ? "" : "s"}`}
            </button>
          </div>
          {routeMutation.isError ? <p className="error">{getErrorMessage(routeMutation.error)}</p> : null}
        </form>
        </article>
      ) : null}

      <article className="panel">
        <h3>Assigned routes</h3>
        {assignedQuery.isLoading ? (
          <p className="subtext">Loading…</p>
        ) : assignedRoutes.length === 0 ? (
          <p className="subtext">No routes are assigned for today yet.</p>
        ) : (
          <>
          <p className="subtext assigned-route-hint">
            Cancel a route to pull it back (kept on record) or remove it to delete it — either
            frees its un-serviced locations to reassign.
          </p>
          <ul className="assigned-route-list">
            {assignedRoutes.map((ar) => {
              const open = expandedOperator === ar.id;
              const serviced = ar.stops.filter((s) => s.servicedAt).length;
              const status = ar.status;
              const totalStops = ar.stops.length;
              const progressPct = totalStops > 0 ? (serviced / totalStops) * 100 : 0;
              const isComplete = status === "COMPLETED" || (totalStops > 0 && serviced === totalStops);
              const statusBadge =
                status === "COMPLETED"
                  ? { cls: "covered", text: "✓ Completed" }
                  : status === "CANCELLED"
                    ? { cls: "uncovered", text: "Cancelled" }
                    : status === "ACCEPTED"
                      ? { cls: "covered", text: "✓ Accepted" }
                      : { cls: "uncovered", text: "Awaiting accept" };
              // A completed route is done — it can't be cancelled anymore.
              const canCancel = status === "ACCEPTED";
              return (
                <li className={`assigned-route${status === "CANCELLED" ? " is-cancelled" : ""}`} key={ar.id}>
                  <div className="assigned-route-row">
                    <button
                      type="button"
                      className="assigned-route-head"
                      aria-expanded={open}
                      onClick={() => setExpandedOperator(open ? null : ar.id)}
                    >
                      <span className="assigned-route-chevron">{open ? "▾" : "▸"}</span>
                      <span
                        className="route-color-dot"
                        style={{ background: routeColorById.get(ar.id) }}
                        aria-hidden="true"
                      />
                      <strong>{ar.operatorName}</strong>
                      {ar.label ? <span className="assigned-route-label">{ar.label}</span> : null}
                      <span className="assigned-route-count">
                        <span
                          className={`ar-frac${serviced > 0 ? " has-done" : ""}${
                            isComplete ? " all-done" : ""
                          }`}
                        >
                          <span className="ar-frac-done">{serviced}</span>
                          <span className="ar-frac-total">/{totalStops}</span>
                        </span>{" "}
                        serviced · ~{formatMinutes(estimatedRouteMinutes(ar))}
                      </span>
                      <span className={`coverage-badge ${statusBadge.cls}`}>{statusBadge.text}</span>
                    </button>
                    {status === "ASSIGNED" ? (
                      <div className="assigned-route-actions">
                        <button
                          type="button"
                          className="assigned-route-cancel"
                          disabled={cancelMutation.isPending}
                          onClick={() => promptAndCancel(ar)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="address-row-remove"
                          disabled={deleteMutation.isPending}
                          title="Delete without keeping a record"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove ${ar.operatorName}'s route entirely (no cancellation record)? Its locations become assignable again.`
                              )
                            ) {
                              deleteMutation.mutate(ar.id);
                            }
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : canCancel ? (
                      <button
                        type="button"
                        className="assigned-route-cancel"
                        disabled={cancelMutation.isPending}
                        onClick={() => promptAndCancel(ar)}
                      >
                        Cancel route
                      </button>
                    ) : (
                      <span className="assigned-route-lock">✓</span>
                    )}
                  </div>
                  {status === "CANCELLED" && ar.cancelReason ? (
                    <p className="assigned-route-cancel-note">
                      <strong>Cancelled:</strong> {ar.cancelReason}
                    </p>
                  ) : null}
                  {open ? (
                    <div className="assigned-route-expand">
                      <ol className="route-stop-list assigned-route-detail">
                        {ar.stops.map((stop) => (
                          <li
                            className={`route-stop${stop.servicedAt ? " is-serviced" : ""}`}
                            key={stop.addressId}
                          >
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
                                ·{" "}
                                {stop.cans.length > 0
                                  ? formatCans(stop.cans)
                                  : `${stop.canCount} can${stop.canCount === 1 ? "" : "s"}`}
                                {stop.servicedAt ? " · ✓ serviced" : ""}
                              </span>
                              <StopServicePhotos
                                verification={stop.serviceVerification}
                                accessToken={accessToken}
                              />
                            </div>
                          </li>
                        ))}
                      </ol>
                      {ar.stops.length > 0 ? (
                        <RouteDetailMap route={ar} color={routeColorById.get(ar.id) ?? "#7b2ff7"} />
                      ) : null}
                    </div>
                  ) : null}
                  {status !== "CANCELLED" ? (
                    <div
                      className="assigned-route-progress"
                      role="img"
                      aria-label={`${serviced} of ${totalStops} stops serviced`}
                    >
                      <div
                        className={`assigned-route-progress-fill${isComplete ? " is-complete" : ""}`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          </>
        )}
        {assignedQuery.isError ? (
          <p className="error">{getErrorMessage(assignedQuery.error)}</p>
        ) : null}
        {deleteMutation.isError ? (
          <p className="error">{getErrorMessage(deleteMutation.error)}</p>
        ) : null}
        {cancelMutation.isError ? (
          <p className="error">{getErrorMessage(cancelMutation.error)}</p>
        ) : null}
      </article>

      <article className="panel">
        <div className="panel-head-row">
          <h3>Today's serviceable locations{scope}</h3>
          <span className="detail-total">
            {scopeLocations.length} location{scopeLocations.length === 1 ? "" : "s"}
          </span>
        </div>
        <p className="subtext">
          Today's work: roll carts <strong>out</strong> for tomorrow's pickups and roll carts{" "}
          <strong>in</strong> from yesterday's. Tap a pin to see which applies.
        </p>
        {locationsQuery.isLoading ? (
          <p className="subtext">Loading…</p>
        ) : scopeLocations.length === 0 ? (
          <p className="subtext">Nothing to service today{scope} — no roll-outs or roll-ins due.</p>
        ) : (
          <>
            <LocationsMap locations={scopeLocations} routes={mapRoutes} />
            <div className="map-legend">
              <span>
                <span className="legend-dot" style={{ background: COLOR_UNASSIGNED }} /> Unassigned (
                {scopedUnassigned})
              </span>
              <span>
                <span className="legend-dot" style={{ background: COLOR_AWAITING }} /> Awaiting
                acceptance ({awaitingCount})
              </span>
              <span>
                <span className="legend-dot" style={{ background: COLOR_ACCEPTED }} /> Accepted (
                {acceptedCount})
              </span>
              <span>
                <span className="legend-dot" style={{ background: COLOR_SERVICED }} /> Serviced (
                {servicedCount})
              </span>
            </div>
          </>
        )}
        {locationsQuery.isError ? (
          <p className="error">{getErrorMessage(locationsQuery.error)}</p>
        ) : null}
      </article>
    </div>
  );
}
