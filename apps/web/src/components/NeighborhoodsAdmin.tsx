import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  createNeighborhood,
  deleteNeighborhood,
  getAdminLocations,
  getNeighborhoods,
  getZones,
  setLocationNeighborhood,
  updateNeighborhood
} from "../lib/api";

type NeighborhoodsAdminProps = {
  accessToken: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

// Split a free-text field into a deduped list of zip codes (comma/space/newline).
function parseZips(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[\s,]+/)
        .map((z) => z.trim())
        .filter(Boolean)
    )
  );
}

export function NeighborhoodsAdmin({ accessToken }: NeighborhoodsAdminProps): JSX.Element {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newState, setNewState] = useState("");
  const [newZips, setNewZips] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editState, setEditState] = useState("");
  const [editZips, setEditZips] = useState("");
  const [newZoneId, setNewZoneId] = useState("");
  const [editZoneId, setEditZoneId] = useState("");
  const [locFilter, setLocFilter] = useState<"UNASSIGNED" | "ALL">("UNASSIGNED");

  const [searchParams, setSearchParams] = useSearchParams();
  const zoneFilter = searchParams.get("zone") ?? "";

  const zonesQuery = useQuery({ queryKey: ["zones"], queryFn: async () => getZones(accessToken) });
  const zones = zonesQuery.data?.zones ?? [];
  const zoneName = (id: string | null) => (id ? zones.find((z) => z.id === id)?.name ?? null : null);

  const neighborhoodsQuery = useQuery({
    queryKey: ["neighborhoods"],
    queryFn: async () => getNeighborhoods(accessToken)
  });
  const locationsQuery = useQuery({
    queryKey: ["admin-locations"],
    queryFn: async () => getAdminLocations(accessToken)
  });

  const allNeighborhoods = neighborhoodsQuery.data?.neighborhoods ?? [];
  // When drilled in from a zone, show only that zone's neighborhoods.
  const neighborhoods = zoneFilter
    ? allNeighborhoods.filter((n) => n.zoneId === zoneFilter)
    : allNeighborhoods;
  const locations = locationsQuery.data?.locations ?? [];
  const unassignedLocations = locations.filter((loc) => !loc.neighborhoodId);
  const visibleLocations = locFilter === "UNASSIGNED" ? unassignedLocations : locations;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["neighborhoods"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-locations"] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createNeighborhood(
        {
          name: newName.trim(),
          city: newCity.trim() || null,
          state: newState.trim() || null,
          zipCodes: parseZips(newZips),
          zoneId: newZoneId || null
        },
        accessToken
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(["neighborhoods"], data);
      setNewName("");
      setNewCity("");
      setNewState("");
      setNewZips("");
      setNewZoneId("");
    }
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNeighborhood(id, accessToken),
    onSuccess: (data) => {
      queryClient.setQueryData(["neighborhoods"], data);
      void queryClient.invalidateQueries({ queryKey: ["admin-locations"] });
    }
  });
  const updateMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      updateNeighborhood(
        id,
        {
          name: editName.trim(),
          city: editCity.trim() || null,
          state: editState.trim() || null,
          zipCodes: parseZips(editZips),
          zoneId: editZoneId || null
        },
        accessToken
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(["neighborhoods"], data);
      void queryClient.invalidateQueries({ queryKey: ["admin-locations"] });
      setEditingId(null);
    }
  });
  const assignMutation = useMutation({
    mutationFn: ({ addressId, neighborhoodId }: { addressId: string; neighborhoodId: string | null }) =>
      setLocationNeighborhood(addressId, neighborhoodId, accessToken),
    onSuccess: refresh
  });

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <h2>Neighborhoods</h2>
        <p className="subtext">Group locations into neighborhoods to organize operator routes.</p>
      </div>

      <article className="panel">
        <h3>Neighborhoods</h3>
        {zoneFilter ? (
          <p className="subtext">
            Showing neighborhoods in <strong>{zoneName(zoneFilter) ?? "this zone"}</strong>.{" "}
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.delete("zone");
                setSearchParams(next, { replace: true });
              }}
            >
              Show all
            </button>
          </p>
        ) : null}
        <form
          className="neighborhood-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (newName.trim()) createMutation.mutate();
          }}
        >
          <div className="neighborhood-fields">
            <input
              className="nb-name"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Neighborhood name"
            />
            <input
              className="nb-city"
              value={newCity}
              onChange={(event) => setNewCity(event.target.value)}
              placeholder="City"
            />
            <input
              className="nb-state"
              value={newState}
              onChange={(event) => setNewState(event.target.value)}
              placeholder="State"
            />
            <input
              className="nb-zips"
              value={newZips}
              onChange={(event) => setNewZips(event.target.value)}
              placeholder="Zip codes (comma-separated)"
            />
            <select
              className="nb-zone"
              value={newZoneId}
              onChange={(event) => setNewZoneId(event.target.value)}
            >
              <option value="">No zone</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="add-day-btn" disabled={!newName.trim() || createMutation.isPending}>
            {createMutation.isPending ? "Adding…" : "+ Add neighborhood"}
          </button>
        </form>
        {createMutation.isError ? <p className="error">{getErrorMessage(createMutation.error)}</p> : null}
        {updateMutation.isError ? <p className="error">{getErrorMessage(updateMutation.error)}</p> : null}

        {neighborhoodsQuery.isLoading ? (
          <p className="subtext">Loading…</p>
        ) : neighborhoods.length === 0 ? (
          <p className="subtext">No neighborhoods yet. Add one above.</p>
        ) : (
          <ul className="neighborhood-list">
            {neighborhoods.map((n) => (
              <li className="neighborhood-row" key={n.id}>
                {editingId === n.id ? (
                  <form
                    className="neighborhood-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (editName.trim()) updateMutation.mutate({ id: n.id });
                    }}
                  >
                    <div className="neighborhood-fields">
                      <input
                        className="nb-name"
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        placeholder="Neighborhood name"
                        autoFocus
                      />
                      <input
                        className="nb-city"
                        value={editCity}
                        onChange={(event) => setEditCity(event.target.value)}
                        placeholder="City"
                      />
                      <input
                        className="nb-state"
                        value={editState}
                        onChange={(event) => setEditState(event.target.value)}
                        placeholder="State"
                      />
                      <input
                        className="nb-zips"
                        value={editZips}
                        onChange={(event) => setEditZips(event.target.value)}
                        placeholder="Zip codes (comma-separated)"
                      />
                      <select
                        className="nb-zone"
                        value={editZoneId}
                        onChange={(event) => setEditZoneId(event.target.value)}
                      >
                        <option value="">No zone</option>
                        {zones.map((z) => (
                          <option key={z.id} value={z.id}>
                            {z.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="neighborhood-row-actions">
                      <button
                        type="submit"
                        className="add-day-btn"
                        disabled={!editName.trim() || updateMutation.isPending}
                      >
                        {updateMutation.isPending ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        className="address-row-remove"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div>
                      <strong>{n.name}</strong>
                      <span className="admin-table-sub">
                        {zoneName(n.zoneId) ? `${zoneName(n.zoneId)} · ` : "No zone · "}
                        {[n.city, n.state].filter(Boolean).join(", ") || "No city/state set"}
                        {n.zipCodes.length > 0 ? ` · ${n.zipCodes.join(", ")}` : ""}
                      </span>
                      <span className="admin-table-sub">
                        {n.locationCount} location{n.locationCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="neighborhood-row-actions">
                      <Link className="ghost-btn" to={`/admin/locations?neighborhood=${n.id}`}>
                        Locations →
                      </Link>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => {
                          setEditingId(n.id);
                          setEditName(n.name);
                          setEditCity(n.city ?? "");
                          setEditState(n.state ?? "");
                          setEditZips(n.zipCodes.join(", "));
                          setEditZoneId(n.zoneId ?? "");
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="address-row-remove"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Delete "${n.name}"? Its locations become unassigned.`)) {
                            deleteMutation.mutate(n.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </article>

      {unassignedLocations.length > 0 ? (
        <article className="panel assign-attention">
          <div className="panel-head-row">
            <h3>
              Locations needing a neighborhood
              <span className="count-badge">{unassignedLocations.length}</span>
            </h3>
            <select
              className="assign-loc-filter"
              value={locFilter}
              onChange={(event) => setLocFilter(event.target.value as "UNASSIGNED" | "ALL")}
            >
              <option value="UNASSIGNED">Unassigned only</option>
              <option value="ALL">All locations</option>
            </select>
          </div>
          <p className="subtext">Assign each location to a neighborhood so it can be added to routes.</p>
          <ul className="assign-loc-list">
            {visibleLocations.map((loc) => (
              <li className={`assign-loc${loc.neighborhoodId ? "" : " is-unassigned"}`} key={loc.id}>
                <div className="assign-loc-main">
                  <strong>{loc.line1}</strong>
                  <span className="admin-table-sub">
                    {loc.city}, {loc.state} {loc.postalCode} · {loc.customerName}
                  </span>
                </div>
                <select
                  value={loc.neighborhoodId ?? ""}
                  onChange={(event) =>
                    assignMutation.mutate({
                      addressId: loc.id,
                      neighborhoodId: event.target.value || null
                    })
                  }
                >
                  <option value="">Unassigned</option>
                  {neighborhoods.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          {assignMutation.isError ? <p className="error">{getErrorMessage(assignMutation.error)}</p> : null}
        </article>
      ) : null}
    </div>
  );
}
