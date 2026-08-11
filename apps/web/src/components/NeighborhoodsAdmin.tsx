import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createNeighborhood,
  deleteNeighborhood,
  getAdminLocations,
  getNeighborhoods,
  renameNeighborhood,
  setLocationNeighborhood
} from "../lib/api";

type NeighborhoodsAdminProps = {
  accessToken: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function NeighborhoodsAdmin({ accessToken }: NeighborhoodsAdminProps): JSX.Element {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const neighborhoodsQuery = useQuery({
    queryKey: ["neighborhoods"],
    queryFn: async () => getNeighborhoods(accessToken)
  });
  const locationsQuery = useQuery({
    queryKey: ["admin-locations"],
    queryFn: async () => getAdminLocations(accessToken)
  });

  const neighborhoods = neighborhoodsQuery.data?.neighborhoods ?? [];
  const locations = locationsQuery.data?.locations ?? [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["neighborhoods"] });
    void queryClient.invalidateQueries({ queryKey: ["admin-locations"] });
  };

  const createMutation = useMutation({
    mutationFn: () => createNeighborhood(newName.trim(), accessToken),
    onSuccess: (data) => {
      queryClient.setQueryData(["neighborhoods"], data);
      setNewName("");
    }
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNeighborhood(id, accessToken),
    onSuccess: (data) => {
      queryClient.setQueryData(["neighborhoods"], data);
      void queryClient.invalidateQueries({ queryKey: ["admin-locations"] });
    }
  });
  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameNeighborhood(id, name, accessToken),
    onSuccess: (data) => {
      queryClient.setQueryData(["neighborhoods"], data);
      void queryClient.invalidateQueries({ queryKey: ["admin-locations"] });
      setEditingId(null);
      setEditName("");
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
        <form
          className="neighborhood-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (newName.trim()) createMutation.mutate();
          }}
        >
          <input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New neighborhood name"
          />
          <button type="submit" className="add-day-btn" disabled={!newName.trim() || createMutation.isPending}>
            {createMutation.isPending ? "Adding…" : "+ Add"}
          </button>
        </form>
        {createMutation.isError ? <p className="error">{getErrorMessage(createMutation.error)}</p> : null}
        {renameMutation.isError ? <p className="error">{getErrorMessage(renameMutation.error)}</p> : null}

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
                    className="neighborhood-add"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const trimmed = editName.trim();
                      if (trimmed && trimmed !== n.name) {
                        renameMutation.mutate({ id: n.id, name: trimmed });
                      } else {
                        setEditingId(null);
                      }
                    }}
                  >
                    <input
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      autoFocus
                    />
                    <button type="submit" className="add-day-btn" disabled={!editName.trim() || renameMutation.isPending}>
                      {renameMutation.isPending ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      className="address-row-remove"
                      onClick={() => {
                        setEditingId(null);
                        setEditName("");
                      }}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <div>
                      <strong>{n.name}</strong>
                      <span className="admin-table-sub">
                        {n.locationCount} location{n.locationCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="neighborhood-row-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => {
                          setEditingId(n.id);
                          setEditName(n.name);
                        }}
                      >
                        Rename
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

      <article className="panel">
        <h3>Assign locations</h3>
        <p className="subtext">Set which neighborhood each location belongs to.</p>
        {locationsQuery.isLoading ? (
          <p className="subtext">Loading locations…</p>
        ) : locations.length === 0 ? (
          <p className="subtext">No locations yet.</p>
        ) : (
          <ul className="assign-loc-list">
            {locations.map((loc) => (
              <li className="assign-loc" key={loc.id}>
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
        )}
        {assignMutation.isError ? <p className="error">{getErrorMessage(assignMutation.error)}</p> : null}
      </article>
    </div>
  );
}
