import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CustomerHistoryStop } from "@gpp/shared";
import { listHistoryJobs } from "../lib/api";
import { formatCans } from "./CanRowsEditor";
import { StopServicePhotos } from "./StopServicePhotos";

type CustomerHistoryProps = { accessToken: string; enabled?: boolean };

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

// Service dates are UTC-midnight; render them without local-timezone day drift.
function formatDay(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
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

const STATUS_META: Record<CustomerHistoryStop["status"], { cls: string; text: string }> = {
  SERVICED: { cls: "covered", text: "Serviced" },
  PENDING: { cls: "uncovered", text: "Not serviced" },
  SKIPPED: { cls: "uncovered", text: "Skipped" },
  FAILED: { cls: "uncovered", text: "Issue reported" }
};

function actionLabel(jobTypes: CustomerHistoryStop["jobTypes"]): string {
  const out = jobTypes.includes("CURB_OUT");
  const inn = jobTypes.includes("CURB_IN");
  if (out && inn) return "Roll-out + Roll-in";
  if (out) return "Roll-out";
  if (inn) return "Roll-in";
  return "Service";
}

// A compact read-only map centered on the customer's own stop.
function StopMiniMap({
  lat,
  lng,
  serviced
}: {
  lat: number;
  lng: number;
  serviced: boolean;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      attributionControl: false,
      zoomControl: false
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    const icon = L.divIcon({
      className: "route-pin-wrap",
      html: `<span class="route-pin" style="background:${serviced ? "#16a34a" : "#055a5f"}">📍</span>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
    L.marker([lat, lng], { icon }).addTo(map);
    map.setView([lat, lng], 16);
    setTimeout(() => map.invalidateSize(), 0);
    mapRef.current = map;
  }, [lat, lng, serviced]);

  return <div className="history-stop-map" ref={containerRef} />;
}

export function CustomerHistory({ accessToken, enabled = true }: CustomerHistoryProps): JSX.Element {
  const historyQuery = useQuery({
    queryKey: ["customer-jobs-history"],
    queryFn: async () => listHistoryJobs(accessToken),
    enabled
  });
  const stops = historyQuery.data?.stops ?? [];

  return (
    <div className="dash-page">
      <div className="dash-page-head">
        <h2>Recent History</h2>
        <p className="subtext">A look back at your recent pickups — what we handled, when, and where.</p>
      </div>

      {historyQuery.isLoading ? (
        <p className="subtext">Loading your history…</p>
      ) : historyQuery.isError ? (
        <p className="error">{getErrorMessage(historyQuery.error)}</p>
      ) : stops.length === 0 ? (
        <article className="panel">
          <p className="subtext">No past pickups yet. Once we service your carts, they'll show up here.</p>
        </article>
      ) : (
        <ul className="history-stop-list">
          {stops.map((stop) => {
            const meta = STATUS_META[stop.status];
            const cans =
              stop.cans.length > 0
                ? formatCans(stop.cans)
                : `${stop.canCount} can${stop.canCount === 1 ? "" : "s"}`;
            const hasCoords = stop.lat !== 0 || stop.lng !== 0;
            return (
              <li className="history-stop" key={stop.id}>
                <div className="history-stop-main">
                  <div className="history-stop-head">
                    <div className="history-stop-when">
                      <strong className="history-stop-date">{formatDay(stop.serviceDate)}</strong>
                      <span className="admin-table-sub">
                        {stop.line1}, {stop.city}, {stop.state} {stop.postalCode}
                      </span>
                    </div>
                    <span className={`coverage-badge ${meta.cls}`}>{meta.text}</span>
                  </div>

                  <div className="history-stop-facts">
                    <span className="history-chip">{actionLabel(stop.jobTypes)}</span>
                    <span className="history-chip">{cans}</span>
                    {stop.petWasteDogs > 0 ? (
                      <span className="history-chip">
                        🐾 Pet waste ({stop.petWasteDogs} dog{stop.petWasteDogs === 1 ? "" : "s"})
                      </span>
                    ) : null}
                    {stop.servicedAt ? (
                      <span className="history-chip is-time">✓ {formatStamp(stop.servicedAt)}</span>
                    ) : null}
                    {stop.operatorName ? (
                      <span className="history-chip is-muted">by {stop.operatorName}</span>
                    ) : null}
                  </div>

                  {stop.failureReason ? (
                    <p className="history-stop-reason">⚠︎ {stop.failureReason}</p>
                  ) : null}

                  <StopServicePhotos verification={stop.verification} accessToken={accessToken} />
                </div>
                {hasCoords ? (
                  <StopMiniMap lat={stop.lat} lng={stop.lng} serviced={stop.status === "SERVICED"} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
