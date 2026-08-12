import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { formatUsd } from "@gpp/shared";
import { getAdminLocations, getNeighborhoods, getZones } from "../lib/api";

type AdminLocationsProps = { accessToken: string };

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function AdminLocations({ accessToken }: AdminLocationsProps): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const zoneFilter = searchParams.get("zone") ?? "";
  const neighborhoodFilter = searchParams.get("neighborhood") ?? "";

  const setFilter = (key: "zone" | "neighborhood", value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    // Changing the zone clears a stale neighborhood selection.
    if (key === "zone") next.delete("neighborhood");
    setSearchParams(next, { replace: true });
  };

  const locationsQuery = useQuery({
    queryKey: ["admin-locations"],
    queryFn: async () => getAdminLocations(accessToken)
  });
  const zonesQuery = useQuery({ queryKey: ["zones"], queryFn: async () => getZones(accessToken) });
  const neighborhoodsQuery = useQuery({
    queryKey: ["neighborhoods"],
    queryFn: async () => getNeighborhoods(accessToken)
  });

  const locations = locationsQuery.data?.locations ?? [];
  const zones = zonesQuery.data?.zones ?? [];
  const neighborhoods = neighborhoodsQuery.data?.neighborhoods ?? [];
  const neighborhoodOptions = zoneFilter
    ? neighborhoods.filter((n) => n.zoneId === zoneFilter)
    : neighborhoods;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return locations.filter((l) => {
      if (zoneFilter && l.zoneId !== zoneFilter) return false;
      if (neighborhoodFilter && l.neighborhoodId !== neighborhoodFilter) return false;
      if (q) {
        const hay = `${l.line1} ${l.city} ${l.state} ${l.postalCode} ${l.customerName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [locations, zoneFilter, neighborhoodFilter, search]);

  const totalMonthly = filtered.reduce((sum, l) => sum + l.monthlyCents, 0);

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <h2>Locations</h2>
        <p className="subtext">
          Every service location you administer. Filter by zone, neighborhood, or search.
        </p>
      </div>

      <article className="panel">
        <div className="loc-filters">
          <label className="loc-filter">
            <span>Zone</span>
            <select value={zoneFilter} onChange={(e) => setFilter("zone", e.target.value)}>
              <option value="">All zones</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                  {z.isTest ? " (Test)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="loc-filter">
            <span>Neighborhood</span>
            <select
              value={neighborhoodFilter}
              onChange={(e) => setFilter("neighborhood", e.target.value)}
            >
              <option value="">All neighborhoods</option>
              {neighborhoodOptions.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </label>
          <label className="loc-filter loc-filter-search">
            <span>Search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Address or customer…"
            />
          </label>
        </div>

        <div className="loc-summary">
          <strong>{filtered.length}</strong> location{filtered.length === 1 ? "" : "s"} ·{" "}
          {formatUsd(totalMonthly)}/mo
        </div>

        {locationsQuery.isLoading ? (
          <p className="subtext">Loading…</p>
        ) : locationsQuery.isError ? (
          <p className="error">{getErrorMessage(locationsQuery.error)}</p>
        ) : filtered.length === 0 ? (
          <p className="subtext">No locations match these filters.</p>
        ) : (
          <ul className="loc-list">
            {filtered.map((l) => (
              <li className="loc-row" key={l.id}>
                <Link
                  className="loc-row-main"
                  to={`/admin/users/${l.userId}#address-${l.id}`}
                  title={`Open ${l.customerName}'s account`}
                >
                  <strong>{l.line1}</strong>
                  <span className="admin-table-sub">
                    {l.city}, {l.state} {l.postalCode} · {l.customerName}
                  </span>
                </Link>
                <div className="loc-row-tags">
                  {l.zoneName ? <span className="loc-chip is-zone">{l.zoneName}</span> : null}
                  {l.neighborhoodName ? (
                    <span className="loc-chip">{l.neighborhoodName}</span>
                  ) : (
                    <span className="loc-chip is-none">No neighborhood</span>
                  )}
                  <span className="loc-chip is-plain">
                    {l.canCount} can{l.canCount === 1 ? "" : "s"}
                  </span>
                  {l.glassRecycling ? <span className="loc-chip is-glass">Glass ♻️</span> : null}
                </div>
                <div className="loc-row-price">{formatUsd(l.monthlyCents)}/mo</div>
              </li>
            ))}
          </ul>
        )}
      </article>
    </div>
  );
}
