import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { AdminTodaysLocation } from "@gpp/shared";
import {
  deleteRoute,
  getAssignedRoutes,
  getAvailableOperators,
  getNeighborhoods,
  getRouteSummary,
  getTodaysLocations,
  getTodaysRoute
} from "../lib/api";

type TodaysRouteProps = {
  accessToken: string;
};

// Pin colors for the serviceable-locations map.
const COLOR_ASSIGNED = "#055a5f";
const COLOR_UNASSIGNED = "#f7a81b";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Read-only map of every serviceable location scheduled today. Pins are colored
// by whether the location is already on a route.
function LocationsMap({ locations }: { locations: AdminTodaysLocation[] }): JSX.Element {
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

    const pin = (color: string) =>
      L.divIcon({
        className: "loc-pin-wrap",
        html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></span>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });

    const bounds: Array<[number, number]> = [];
    locations.forEach((loc) => {
      L.marker([loc.lat, loc.lng], { icon: pin(loc.assigned ? COLOR_ASSIGNED : COLOR_UNASSIGNED) })
        .bindPopup(
          `<strong>${loc.line1}</strong><br>${loc.city}, ${loc.state} ${loc.postalCode}<br>${loc.customerName}<br>${
            loc.assigned ? "On a route" : "Unassigned"
          }`
        )
        .addTo(layer);
      bounds.push([loc.lat, loc.lng]);
    });

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 17 });
    }
    setTimeout(() => map.invalidateSize(), 0);
  }, [locations]);

  return <div className="route-map" ref={containerRef} />;
}

export function TodaysRoute({ accessToken }: TodaysRouteProps): JSX.Element {
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

  const neighborhoodsQuery = useQuery({
    queryKey: ["neighborhoods"],
    queryFn: async () => getNeighborhoods(accessToken)
  });
  const neighborhoods = neighborhoodsQuery.data?.neighborhoods ?? [];
  const [neighborhoodId, setNeighborhoodId] = useState("");
  const selectedHood = neighborhoods.find((n) => n.id === neighborhoodId) ?? null;

  // Cheap counts for the selected scope so we can show the "nothing to assign"
  // notice and disable the button before the admin clicks Assign.
  const summaryQuery = useQuery({
    queryKey: ["route-summary", neighborhoodId],
    queryFn: async () => getRouteSummary(neighborhoodId || undefined, accessToken)
  });
  const summary = summaryQuery.data;
  const nothingToAssign = Boolean(summary && summary.unassigned === 0);
  const summaryReason = summary && summary.scheduledToday === 0 ? "none_scheduled" : "all_assigned";

  // Every serviceable location scheduled today (for the map).
  const locationsQuery = useQuery({
    queryKey: ["today-locations", neighborhoodId],
    queryFn: async () => getTodaysLocations(neighborhoodId || undefined, accessToken)
  });
  const locations = locationsQuery.data?.locations ?? [];
  const assignedCount = locations.filter((l) => l.assigned).length;

  const invalidateRouteViews = () => {
    void queryClient.invalidateQueries({ queryKey: ["route-summary"] });
    void queryClient.invalidateQueries({ queryKey: ["today-locations"] });
  };

  const deleteMutation = useMutation({
    mutationFn: (routeId: string) => deleteRoute(routeId, accessToken),
    onSuccess: (data) => {
      queryClient.setQueryData(["assigned-routes"], data);
      invalidateRouteViews();
    }
  });

  const routeMutation = useMutation({
    mutationFn: () =>
      getTodaysRoute(
        {
          neighborhoodId: neighborhoodId || undefined,
          operatorIds: [...selected]
        },
        accessToken
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["assigned-routes"] });
      invalidateRouteViews();
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
  const emptyMessage =
    summaryReason === "all_assigned"
      ? `Every pickup${scope} today is already on a route. Remove a route above to free up its locations, then reassign.`
      : `No pickups are scheduled for today${scope}.`;
  const emptyIcon = summaryReason === "all_assigned" ? "⚠️" : "🗓️";

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
              const open = expandedOperator === ar.id;
              const accepted = ar.status === "ACCEPTED";
              return (
                <li className="assigned-route" key={ar.id}>
                  <div className="assigned-route-row">
                    <button
                      type="button"
                      className="assigned-route-head"
                      aria-expanded={open}
                      onClick={() => setExpandedOperator(open ? null : ar.id)}
                    >
                      <span className="assigned-route-chevron">{open ? "▾" : "▸"}</span>
                      <strong>{ar.operatorName}</strong>
                      {ar.label ? <span className="assigned-route-label">{ar.label}</span> : null}
                      <span className="assigned-route-count">
                        {ar.stops.length} stop{ar.stops.length === 1 ? "" : "s"}
                      </span>
                      <span className={`coverage-badge ${accepted ? "covered" : "uncovered"}`}>
                        {accepted ? "✓ Accepted" : "Awaiting accept"}
                      </span>
                    </button>
                    {accepted ? (
                      <span className="assigned-route-lock" title="Locked — operator accepted this route">
                        🔒
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="address-row-remove"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Remove ${ar.operatorName}'s route? Its locations become assignable again.`)) {
                            deleteMutation.mutate(ar.id);
                          }
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
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
        {deleteMutation.isError ? (
          <p className="error">{getErrorMessage(deleteMutation.error)}</p>
        ) : null}
      </article>

      <article className="panel assign-panel">
        <h3>Assign a route</h3>
        <form onSubmit={handleSubmit}>
          <ol className="assign-steps">
            <li className="assign-step">
              <div className="assign-step-head">
                <span className="assign-step-num">1</span>
                <div>
                  <strong>Choose an area</strong>
                  <span className="subtext">Route all of today's pickups, or just one neighborhood.</span>
                </div>
              </div>
              <select
                className="assign-select"
                value={neighborhoodId}
                onChange={(event) => setNeighborhoodId(event.target.value)}
              >
                <option value="">All locations</option>
                {neighborhoods.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.locationCount})
                  </option>
                ))}
              </select>
              {selectedHood && selectedHood.locationCount === 0 ? (
                <p className="subtext route-hood-hint">
                  {selectedHood.name} has no locations assigned yet — add some on the Neighborhoods
                  page before assigning a route here.
                </p>
              ) : summary && summary.unassigned > 0 ? (
                <p className="assign-ready">
                  {summary.unassigned} pickup{summary.unassigned === 1 ? "" : "s"} ready to assign
                  {scope}.
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
                    : `Assign ${summary?.unassigned ?? ""} pickup${summary?.unassigned === 1 ? "" : "s"} to ${selected.size} operator${selected.size === 1 ? "" : "s"}`}
            </button>
          </div>
          {routeMutation.isError ? <p className="error">{getErrorMessage(routeMutation.error)}</p> : null}
        </form>
      </article>

      {nothingToAssign ? (
        <article className="panel">
          <div className={`route-notice${summaryReason === "all_assigned" ? " is-warning" : ""}`}>
            <span className="route-notice-icon" aria-hidden="true">
              {emptyIcon}
            </span>
            <span>{emptyMessage}</span>
          </div>
        </article>
      ) : null}

      <article className="panel">
        <div className="panel-head-row">
          <h3>Today's serviceable locations{scope}</h3>
          <span className="detail-total">
            {locations.length} location{locations.length === 1 ? "" : "s"}
          </span>
        </div>
        {locationsQuery.isLoading ? (
          <p className="subtext">Loading…</p>
        ) : locations.length === 0 ? (
          <p className="subtext">No serviceable locations are scheduled for pickup today{scope}.</p>
        ) : (
          <>
            <LocationsMap locations={locations} />
            <div className="map-legend">
              <span>
                <span className="legend-dot" style={{ background: COLOR_UNASSIGNED }} /> Unassigned (
                {locations.length - assignedCount})
              </span>
              <span>
                <span className="legend-dot" style={{ background: COLOR_ASSIGNED }} /> On a route (
                {assignedCount})
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
