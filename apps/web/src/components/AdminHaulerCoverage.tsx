import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { PickupScheduleSuggestion } from "@gpp/shared";
import { getHaulerCoverage, getPickupScheduleSuggestion } from "../lib/api";

type AdminHaulerCoverageProps = { accessToken: string };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function AdminHaulerCoverage({ accessToken }: AdminHaulerCoverageProps): JSX.Element {
  const coverageQuery = useQuery({
    queryKey: ["hauler-coverage"],
    queryFn: async () => getHaulerCoverage(accessToken)
  });

  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");

  const checkMutation = useMutation<PickupScheduleSuggestion>({
    mutationFn: async () =>
      getPickupScheduleSuggestion(
        { line1: line1.trim(), city: city.trim(), state: state.trim(), postalCode: postalCode.trim() },
        accessToken
      )
  });

  const providers = coverageQuery.data?.providers ?? [];
  const areas = coverageQuery.data?.areas ?? [];
  const canCheck = Boolean(line1.trim() && city.trim() && state.trim() && postalCode.trim());
  const result = checkMutation.data;

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <h2>Trash Provider Coverage</h2>
        <p className="subtext">
          Which trash-provider lookups are wired up, and where they're actually resolving.
        </p>
      </div>

      {/* Wired providers */}
      <article className="panel">
        <h3>Wired providers</h3>
        {coverageQuery.isLoading ? (
          <p className="subtext">Loading…</p>
        ) : providers.length === 0 ? (
          <p className="subtext">No trash providers are configured.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Trash provider</th>
                <th>Platform</th>
                <th>Coverage</th>
                <th>Schedule lookup</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.label}</strong>
                    <span className="admin-table-sub">{p.id}</span>
                  </td>
                  <td>{p.platform}</td>
                  <td>{p.coverageLabel}</td>
                  <td>
                    <a
                      className="provider-schedule-link"
                      href={p.scheduleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Look up by address ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>

      {/* Live check */}
      <article className="panel">
        <h3>Check an address</h3>
        <p className="subtext">
          Test any address against the live provider lookups — the fastest way to confirm a trash
          provider is available somewhere.
        </p>
        <div className="field-row">
          <label>
            Line 1
            <input value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="63 NE Cessna Dr" />
          </label>
          <label>
            City
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Bend" />
          </label>
        </div>
        <div className="field-row">
          <label>
            State
            <input value={state} onChange={(e) => setState(e.target.value)} placeholder="OR" />
          </label>
          <label>
            Postal code
            <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="97701" />
          </label>
        </div>
        <button
          type="button"
          className="cta-primary"
          disabled={!canCheck || checkMutation.isPending}
          onClick={() => checkMutation.mutate()}
        >
          {checkMutation.isPending ? "Checking…" : "Check address"}
        </button>
        {checkMutation.isError ? <p className="error">{getErrorMessage(checkMutation.error)}</p> : null}
        {result ? (
          result.matched && result.garbage ? (
            <div className="pickup-suggestion" style={{ marginTop: "0.85rem" }}>
              <p>
                <strong>Match — {result.providerLabel}.</strong> Garbage:{" "}
                {WEEKDAYS[result.garbage.dayOfWeek]},{" "}
                {result.garbage.cadence === "BIWEEKLY" ? "every 2 weeks" : "every week"}.
              </p>
              {result.recycling ? (
                <p className="subtext">
                  Recycling: {WEEKDAYS[result.recycling.dayOfWeek]},{" "}
                  {result.recycling.cadence === "BIWEEKLY" ? "every 2 weeks" : "every week"}.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="subtext" style={{ marginTop: "0.85rem" }}>
              No trash provider lookup available for this address — the customer would set their
              schedule manually.
            </p>
          )
        ) : null}
      </article>

      {/* Per-service-area coverage */}
      <article className="panel">
        <h3>Service areas</h3>
        {coverageQuery.isError ? (
          <p className="error">{getErrorMessage(coverageQuery.error)}</p>
        ) : coverageQuery.isLoading ? (
          <p className="subtext">Loading…</p>
        ) : areas.length === 0 ? (
          <p className="subtext">No service areas yet.</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Zone</th>
                <th>Configured</th>
                <th>Matched</th>
                <th>Breakdown</th>
              </tr>
            </thead>
            <tbody>
              {areas.map((area) => (
                <tr key={area.zoneId ?? "none"}>
                  <td>
                    <strong>{area.name}</strong>
                    {area.isTest ? <span className="loc-chip is-none">Test</span> : null}
                    <span className="admin-table-sub">
                      {[area.city, area.state].filter(Boolean).join(", ") || "—"}
                    </span>
                  </td>
                  <td>
                    {area.configuredProviders.length === 0 ? (
                      <span className="admin-table-sub">None</span>
                    ) : (
                      area.configuredProviders.map((p) => (
                        <span key={p.id} className="loc-chip is-zone">
                          {p.label}
                        </span>
                      ))
                    )}
                  </td>
                  <td>
                    <strong>
                      {area.matched}/{area.totalAddresses}
                    </strong>
                    {area.unmatched > 0 ? (
                      <span className="admin-table-sub">{area.unmatched} no match</span>
                    ) : null}
                  </td>
                  <td>
                    {area.matchedByProvider.length === 0 ? (
                      <span className="admin-table-sub">—</span>
                    ) : (
                      area.matchedByProvider
                        .map((m) => `${m.providerLabel}: ${m.count}`)
                        .join(" · ")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </div>
  );
}
