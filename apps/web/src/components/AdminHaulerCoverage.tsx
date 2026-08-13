import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HaulerCoverageResponse, PickupScheduleSuggestion } from "@gpp/shared";
import { getHaulerCoverage, getPickupScheduleSuggestion, refreshProviderCache } from "../lib/api";

type AdminHaulerCoverageProps = { accessToken: string };
type ProviderStatus = HaulerCoverageResponse["providers"][number]["status"];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The provider's own service status (from its cached schedule) → left-border
// class + a short label.
const PROVIDER_STATUS_META: Record<ProviderStatus, { cls: string; label: string }> = {
  NORMAL: { cls: "provider-status-ok", label: "Running normally" },
  HOLIDAY_SHIFT: { cls: "provider-status-warn", label: "Holiday shift ahead" },
  UNKNOWN: { cls: "provider-status-none", label: "No schedule data yet" }
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export function AdminHaulerCoverage({ accessToken }: AdminHaulerCoverageProps): JSX.Element {
  const queryClient = useQueryClient();
  const coverageQuery = useQuery({
    queryKey: ["hauler-coverage"],
    queryFn: async () => getHaulerCoverage(accessToken)
  });
  const refreshMutation = useMutation({
    mutationFn: (providerId: string) => refreshProviderCache(providerId, accessToken),
    onSuccess: () => {
      // Freshened schedules change provider health + area coverage.
      void queryClient.invalidateQueries({ queryKey: ["hauler-coverage"] });
      void queryClient.invalidateQueries({ queryKey: ["day-status"] });
    }
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

  // When arrived at via a Day-Status pill link (…#provider-<id>), scroll that
  // provider row into view and briefly highlight it.
  useEffect(() => {
    if (!providers.length || !window.location.hash.startsWith("#provider-")) return;
    const el = document.getElementById(window.location.hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("row-flash");
    const t = setTimeout(() => el.classList.remove("row-flash"), 2000);
    return () => clearTimeout(t);
  }, [providers.length]);
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
          <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Trash provider</th>
                <th>Platform</th>
                <th>Coverage</th>
                <th>Schedule lookup</th>
                <th>Cache</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => {
                const meta = PROVIDER_STATUS_META[p.status];
                return (
                <tr key={p.id} id={`provider-${p.id}`} className={meta.cls}>
                  <td data-label="Trash provider">
                    <strong>{p.label}</strong>
                    <span className="admin-table-sub">{meta.label}</span>
                  </td>
                  <td data-label="Platform">{p.platform}</td>
                  <td data-label="Coverage">{p.coverageLabel}</td>
                  <td data-label="Schedule lookup">
                    <a
                      className="provider-schedule-link"
                      href={p.scheduleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Look up by address ↗
                    </a>
                  </td>
                  <td data-label="Cache">
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={refreshMutation.isPending && refreshMutation.variables === p.id}
                      onClick={() => refreshMutation.mutate(p.id)}
                    >
                      {refreshMutation.isPending && refreshMutation.variables === p.id
                        ? "Refreshing…"
                        : "↻ Refresh cache"}
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
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
          <div className="table-scroll">
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
                  <td data-label="Zone">
                    <strong>{area.name}</strong>
                    {area.isTest ? <span className="loc-chip is-none">Test</span> : null}
                    <span className="admin-table-sub">
                      {[area.city, area.state].filter(Boolean).join(", ") || "—"}
                    </span>
                  </td>
                  <td data-label="Configured">
                    {area.configuredProviders.length === 0 ? (
                      <span className="admin-table-sub">None</span>
                    ) : (
                      <span className="cell-chips">
                        {area.configuredProviders.map((p) => (
                          <span key={p.id} className="loc-chip is-zone">
                            {p.label}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td data-label="Matched">
                    <strong>
                      {area.matched}/{area.totalAddresses}
                    </strong>
                    {area.unmatched > 0 ? (
                      <span className="admin-table-sub">{area.unmatched} no match</span>
                    ) : null}
                  </td>
                  <td data-label="Breakdown">
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
          </div>
        )}
      </article>
    </div>
  );
}
