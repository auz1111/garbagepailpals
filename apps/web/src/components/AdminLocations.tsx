import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { formatUsd } from "@gpp/shared";
import { getAdminLocations, getNeighborhoods, getZones, setLocationApproval } from "../lib/api";

type AdminLocationsProps = { accessToken: string };

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function AdminLocations({ accessToken }: AdminLocationsProps): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();
  const zoneFilter = searchParams.get("zone") ?? "";
  const neighborhoodFilter = searchParams.get("neighborhood") ?? "";
  const statusFilter = searchParams.get("filter") ?? ""; // "", "pending", "approved"

  const setFilter = (key: "zone" | "neighborhood" | "filter", value: string) => {
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
  const approvalMutation = useMutation({
    mutationFn: (id: string) => setLocationApproval(id, true, accessToken),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-locations"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-metrics"] });
    }
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
      if (statusFilter === "pending" && l.serviceApproved) return false;
      if (statusFilter === "approved" && !l.serviceApproved) return false;
      if (q) {
        const hay = `${l.line1} ${l.city} ${l.state} ${l.postalCode} ${l.customerName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [locations, zoneFilter, neighborhoodFilter, statusFilter, search]);

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
          <label className="loc-filter">
            <span>Status</span>
            <select value={statusFilter} onChange={(e) => setFilter("filter", e.target.value)}>
              <option value="">All statuses</option>
              <option value="pending">Pending approval</option>
              <option value="approved">Approved</option>
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
                    {l.customerName} ·{" "}
                    {l.zoneName ? l.postalCode : `${l.city}, ${l.state} ${l.postalCode}`}
                  </span>
                </Link>
                <div className="loc-row-price">{formatUsd(l.monthlyCents)}/mo</div>
                <div className="loc-row-tags">
                  {l.serviceApproved ? (
                    <span className="loc-chip is-approved">✓ Approved</span>
                  ) : !l.billed ? (
                    <span className="loc-chip is-awaiting" title="Waiting for the customer to activate their plan">
                      💳 Awaiting billing
                    </span>
                  ) : (
                    <>
                      <span className="loc-chip is-pending">⏳ Pending approval</span>
                      <button
                        type="button"
                        className="loc-approve-btn"
                        disabled={approvalMutation.isPending}
                        onClick={() => approvalMutation.mutate(l.id)}
                      >
                        Approve
                      </button>
                    </>
                  )}
                  {l.zoneName ? <span className="loc-chip is-zone">{l.zoneName}</span> : null}
                  {l.neighborhoodName ? (
                    <span className="loc-chip">{l.neighborhoodName}</span>
                  ) : (
                    <span className="loc-chip is-none">No neighborhood</span>
                  )}
                  {l.pickupDays.length > 0 ? (
                    <span className="loc-chip is-days">
                      📅 {l.pickupDays.map((d) => WEEKDAYS_SHORT[d]).join(", ")}
                    </span>
                  ) : null}
                  <span className="loc-chip is-plain">
                    {l.canCount} can{l.canCount === 1 ? "" : "s"}
                  </span>
                  {l.glassRecycling ? <span className="loc-chip is-glass">Glass ♻️</span> : null}
                  {l.petWaste ? <span className="loc-chip is-petwaste">Pet waste 🐕</span> : null}
                  {l.haulerProvider ? (
                    <span
                      className={`loc-chip ${l.providerSynced ? "is-provider-synced" : "is-provider-unsynced"}`}
                      title={l.providerSynced ? "Synced to this trash provider" : "Connected but not synced"}
                    >
                      ♻️ {l.haulerProviderLabel ?? "Provider"}
                      {l.providerSynced ? " ✓" : " • not synced"}
                    </span>
                  ) : (
                    <span className="loc-chip is-none">No trash provider</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </article>
    </div>
  );
}
