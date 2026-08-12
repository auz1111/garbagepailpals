import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createZone, deleteZone, getZones, updateZone } from "../lib/api";

type ZonesAdminProps = { accessToken: string };

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function ZonesAdmin({ accessToken }: ZonesAdminProps): JSX.Element {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newCity, setNewCity] = useState("");
  const [newState, setNewState] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editState, setEditState] = useState("");
  const [editIsTest, setEditIsTest] = useState(false);

  const zonesQuery = useQuery({ queryKey: ["zones"], queryFn: async () => getZones(accessToken) });
  const zones = zonesQuery.data?.zones ?? [];

  const save = (data: Awaited<ReturnType<typeof getZones>>) => {
    queryClient.setQueryData(["zones"], data);
    void queryClient.invalidateQueries({ queryKey: ["neighborhoods"] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createZone(
        { name: newName.trim(), city: newCity.trim() || null, state: newState.trim() || null },
        accessToken
      ),
    onSuccess: (data) => {
      save(data);
      setNewName("");
      setNewCity("");
      setNewState("");
    }
  });
  const updateMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      updateZone(
        id,
        {
          name: editName.trim(),
          city: editCity.trim() || null,
          state: editState.trim() || null,
          isTest: editIsTest
        },
        accessToken
      ),
    onSuccess: (data) => {
      save(data);
      setEditingId(null);
    }
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteZone(id, accessToken),
    onSuccess: save
  });

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <h2>Service Areas (Zones)</h2>
        <p className="subtext">
          Cities/regions you administer. Assign neighborhoods to a zone in Neighborhoods, then
          scope routes and grant zones to pro-operators.
        </p>
      </div>

      <article className="panel">
        <h3>Zones</h3>
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
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Zone name (e.g. Bend, OR)"
            />
            <input
              className="nb-city"
              value={newCity}
              onChange={(e) => setNewCity(e.target.value)}
              placeholder="City"
            />
            <input
              className="nb-state"
              value={newState}
              onChange={(e) => setNewState(e.target.value)}
              placeholder="State"
            />
          </div>
          <button
            type="submit"
            className="add-day-btn"
            disabled={!newName.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? "Adding…" : "+ Add zone"}
          </button>
        </form>
        {createMutation.isError ? <p className="error">{getErrorMessage(createMutation.error)}</p> : null}
        {updateMutation.isError ? <p className="error">{getErrorMessage(updateMutation.error)}</p> : null}
        {deleteMutation.isError ? <p className="error">{getErrorMessage(deleteMutation.error)}</p> : null}

        {zonesQuery.isLoading ? (
          <p className="subtext">Loading…</p>
        ) : zones.length === 0 ? (
          <p className="subtext">No zones yet. Add one above.</p>
        ) : (
          <ul className="neighborhood-list">
            {zones.map((z) => (
              <li className="neighborhood-row" key={z.id}>
                {editingId === z.id ? (
                  <form
                    className="neighborhood-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (editName.trim()) updateMutation.mutate({ id: z.id });
                    }}
                  >
                    <div className="neighborhood-fields">
                      <input
                        className="nb-name"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        autoFocus
                      />
                      <input
                        className="nb-city"
                        value={editCity}
                        onChange={(e) => setEditCity(e.target.value)}
                        placeholder="City"
                      />
                      <input
                        className="nb-state"
                        value={editState}
                        onChange={(e) => setEditState(e.target.value)}
                        placeholder="State"
                      />
                    </div>
                    <label
                      className="nb-test-toggle"
                      title="Excluded from the customer service area"
                    >
                      <input
                        type="checkbox"
                        checked={editIsTest}
                        onChange={(e) => setEditIsTest(e.target.checked)}
                      />
                      Test
                    </label>
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
                      <strong>{z.name}</strong>
                      {z.isTest ? <span className="nb-test-chip">Test</span> : null}
                      <span className="admin-table-sub">
                        {[z.city, z.state].filter(Boolean).join(", ") || "No city/state set"} ·{" "}
                        {z.neighborhoodCount} neighborhood{z.neighborhoodCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="neighborhood-row-actions">
                      <Link className="ghost-btn" to={`/admin/neighborhoods?zone=${z.id}`}>
                        Neighborhoods →
                      </Link>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => {
                          setEditingId(z.id);
                          setEditName(z.name);
                          setEditCity(z.city ?? "");
                          setEditState(z.state ?? "");
                          setEditIsTest(z.isTest);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="address-row-remove"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete zone "${z.name}"? Its neighborhoods stay but become unzoned.`
                            )
                          ) {
                            deleteMutation.mutate(z.id);
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
    </div>
  );
}
