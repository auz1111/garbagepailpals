import { useMemo, useState } from "react";
import type { DailyRoute, RouteStopService, StopServiceVerificationItem } from "@gpp/shared";
import { SERVICE_REGISTRY } from "@gpp/shared";
import { uploadServicePhoto } from "../lib/api";
import { CAN_LABELS } from "./CanRowsEditor";

type RouteStop = DailyRoute["stops"][number];

const MAX_PHOTOS = 3;

// One checklist step: a can or an add-on service to verify at this stop.
type StepDef = { key: string; label: string; sub: string };

// A photo the operator captured for a step: its stored blob path + a local
// preview URL (object URL of the picked file).
type StepPhoto = { path: string; url: string };
type StepState = { checked: boolean; photos: StepPhoto[]; uploading: boolean; error: string | null };

function rollLabel(jobTypes: RouteStop["jobTypes"]): string {
  const out = jobTypes.includes("CURB_OUT");
  const inn = jobTypes.includes("CURB_IN");
  if (out && inn) return "Roll out & roll in";
  if (out) return "Roll cart to the curb";
  if (inn) return "Bring cart back from the curb";
  return "Service";
}

// A checklist step for one non-trash service, labelled from its options.
function serviceStepDef(svc: RouteStopService): StepDef {
  const reg = SERVICE_REGISTRY[svc.type];
  const opts = svc.options ?? {};
  let label = reg.label;
  if (svc.type === "PET_WASTE") {
    const dogs = typeof opts.dogs === "number" ? opts.dogs : 1;
    label = `Pet waste removal (${dogs} dog${dogs === 1 ? "" : "s"})`;
  } else if (svc.type === "PLANT_WATERING") {
    const coverage = typeof opts.coverage === "string" ? opts.coverage.toLowerCase() : "outdoor";
    label = `Plant watering (${coverage})`;
  }
  const sub =
    typeof opts.instructions === "string" && opts.instructions.trim().length > 0
      ? opts.instructions
      : reg.description;
  return { key: `service:${svc.type}`, label, sub };
}

function buildSteps(stop: RouteStop): StepDef[] {
  const steps: StepDef[] = [];
  const roll = rollLabel(stop.jobTypes);
  const cans = stop.cans.length > 0
    ? stop.cans
    : stop.canCount > 0
      ? [{ type: "TRASH" as const, cadence: "WEEKLY" as const, count: stop.canCount }]
      : [];
  for (const can of cans) {
    steps.push({
      key: `can:${can.type}`,
      label: `${can.count} ${CAN_LABELS[can.type]}`,
      sub: roll
    });
  }
  // Non-trash services (mail check, watering, pet waste) each get a step.
  const services = stop.services ?? [];
  for (const svc of services) {
    steps.push(serviceStepDef(svc));
  }
  // Legacy fallback: a route built before `services` existed carries pet waste
  // only as petWasteDogs. Skip if a PET_WASTE service already covered it.
  if (stop.petWasteDogs > 0 && !services.some((s) => s.type === "PET_WASTE")) {
    steps.push({
      key: "service:PET_WASTE",
      label: `Pet waste removal (${stop.petWasteDogs} dog${stop.petWasteDogs === 1 ? "" : "s"})`,
      sub: "Clean up the yard waste into the trash bin"
    });
  }
  return steps;
}

// Step-by-step verification an operator completes before a stop is marked
// serviced: check off each can/service and attach up to 3 photos each.
export function StopServiceVerification({
  stop,
  accessToken,
  saving,
  error,
  onCancel,
  onComplete
}: {
  stop: RouteStop;
  accessToken: string;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onComplete: (verification: StopServiceVerificationItem[]) => void;
}): JSX.Element {
  const steps = useMemo(() => buildSteps(stop), [stop]);
  const [current, setCurrent] = useState(0);
  const [state, setState] = useState<StepState[]>(() =>
    steps.map(() => ({ checked: false, photos: [], uploading: false, error: null }))
  );

  const patch = (i: number, next: Partial<StepState>): void =>
    setState((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...next } : s)));

  async function onPickPhotos(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;
    const remaining = MAX_PHOTOS - (state[current]?.photos.length ?? 0);
    const picked = Array.from(files).slice(0, remaining);
    if (picked.length === 0) return;
    patch(current, { uploading: true, error: null });
    try {
      for (const file of picked) {
        const { path } = await uploadServicePhoto(file, accessToken);
        const url = URL.createObjectURL(file);
        setState((prev) =>
          prev.map((s, idx) =>
            idx === current ? { ...s, photos: [...s.photos, { path, url }] } : s
          )
        );
      }
      patch(current, { uploading: false });
    } catch (e) {
      patch(current, {
        uploading: false,
        error: e instanceof Error ? e.message : "Upload failed"
      });
    }
  }

  function removePhoto(i: number): void {
    setState((prev) =>
      prev.map((s, idx) =>
        idx === current ? { ...s, photos: s.photos.filter((_, p) => p !== i) } : s
      )
    );
  }

  function complete(): void {
    const verification: StopServiceVerificationItem[] = steps.map((s, i) => ({
      key: s.key,
      label: s.label,
      photoBlobPaths: (state[i]?.photos ?? []).map((p) => p.path)
    }));
    onComplete(verification);
  }

  const hasSteps = steps.length > 0;
  const step = steps[current];
  const st = state[current];
  const allChecked = hasSteps && state.every((s) => s.checked);
  const isLast = current >= steps.length - 1;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onCancel}>
      <div className="modal-card verify-modal" onClick={(e) => e.stopPropagation()}>
        <div className="verify-head">
          <div>
            <strong>{stop.line1}</strong>
            <span className="admin-table-sub">
              {stop.city}, {stop.state} · {stop.customerName}
            </span>
          </div>
          <button type="button" className="modal-close" aria-label="Close" onClick={onCancel}>
            ×
          </button>
        </div>

        {!hasSteps || !step || !st ? (
          <>
            <p className="subtext">
              No cans or services are recorded for this stop. Confirm you serviced it.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="cta-primary"
                disabled={saving}
                onClick={() => onComplete([])}
              >
                {saving ? "Saving…" : "✓ Mark serviced"}
              </button>
              <button type="button" className="ghost-btn" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="verify-progress" aria-hidden="true">
              {steps.map((s, i) => (
                <span
                  key={s.key}
                  className={`verify-dot${state[i]?.checked ? " is-done" : ""}${
                    i === current ? " is-current" : ""
                  }`}
                />
              ))}
            </div>
            <p className="verify-step-count">
              Step {current + 1} of {steps.length}
            </p>

            <div className="verify-step">
              <h3 className="verify-step-title">{step.label}</h3>
              <p className="subtext">{step.sub}</p>

              <label className="checkbox-field verify-check">
                <input
                  type="checkbox"
                  checked={st.checked}
                  onChange={(e) => patch(current, { checked: e.target.checked })}
                />
                <span>
                  <strong>Serviced</strong>
                  <span className="subtext">Tick once this one is done.</span>
                </span>
              </label>

              <div className="verify-photos">
                <span className="pickup-day-eyebrow">
                  Photos ({st.photos.length}/{MAX_PHOTOS})
                </span>
                <div className="verify-photo-grid">
                  {st.photos.map((p, i) => (
                    <div className="verify-thumb" key={p.path}>
                      <img src={p.url} alt="" />
                      <button
                        type="button"
                        className="verify-thumb-remove"
                        aria-label="Remove photo"
                        onClick={() => removePhoto(i)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {st.photos.length < MAX_PHOTOS ? (
                    <label className={`verify-add-photo${st.uploading ? " is-busy" : ""}`}>
                      {st.uploading ? "Uploading…" : "+ Add photo"}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        multiple
                        disabled={st.uploading}
                        onChange={(e) => {
                          void onPickPhotos(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  ) : null}
                </div>
                {st.error ? <p className="error">{st.error}</p> : null}
              </div>
            </div>

            <div className="verify-nav">
              <button
                type="button"
                className="ghost-btn"
                disabled={current === 0}
                onClick={() => setCurrent((c) => Math.max(0, c - 1))}
              >
                ← Back
              </button>
              {!isLast ? (
                <button
                  type="button"
                  className="cta-primary"
                  disabled={!st.checked}
                  onClick={() => setCurrent((c) => Math.min(steps.length - 1, c + 1))}
                >
                  Next →
                </button>
              ) : (
                <button
                  type="button"
                  className="cta-primary"
                  disabled={!allChecked || saving}
                  onClick={complete}
                >
                  {saving ? "Saving…" : "✓ Complete & mark serviced"}
                </button>
              )}
            </div>
            {!allChecked && isLast ? (
              <p className="subtext verify-hint">Check off every item to finish.</p>
            ) : null}
            {error ? <p className="error">{error}</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
