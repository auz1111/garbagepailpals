import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CreateAddressRequest,
  PickupDayInput,
  PickupScheduleSuggestion,
  ServiceAddress
} from "@gpp/shared";
import {
  checkServiceArea,
  createAddress,
  getPickupScheduleSuggestion,
  updateAddress,
  updateAddressSchedule
} from "../lib/api";
import { ProviderSyncReview } from "./ProviderSyncReview";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const FRIDAY = 5;

type AddressFields = {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
};

type ManualDay = { dayOfWeek: number; cadence: "WEEKLY" | "BIWEEKLY"; canCount: number };

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

// The next calendar occurrence of a weekday, as an ISO datetime — used to anchor
// a manually-added biweekly day.
function nextDateOfWeekday(weekday: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const delta = ((weekday - d.getUTCDay() + 7) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString();
}

// Three-step "add a location" flow: (1) address + detect trash provider,
// (2) set up pickup days (sync with the provider, or add days manually if none),
// (3) access notes.
export function AddLocationWizard({
  accessToken,
  onDone,
  onCancel
}: {
  accessToken: string;
  onDone: (createdId: string) => void;
  onCancel?: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const form = useForm<AddressFields>({
    defaultValues: { line1: "", city: "", state: "", postalCode: "" }
  });

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [areaCheck, setAreaCheck] = useState<{ postalCode: string; eligible: boolean } | null>(null);
  const [areaChecking, setAreaChecking] = useState(false);
  const [suggestion, setSuggestion] = useState<PickupScheduleSuggestion | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [created, setCreated] = useState<ServiceAddress | null>(null);
  const [manualDays, setManualDays] = useState<ManualDay[]>([
    { dayOfWeek: FRIDAY, cadence: "WEEKLY", canCount: 2 }
  ]);
  const [accessNotes, setAccessNotes] = useState("");

  async function invalidate(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ["customer-addresses"] });
    await queryClient.invalidateQueries({ queryKey: ["customer-billing-summary"] });
  }

  async function detectProvider(): Promise<PickupScheduleSuggestion | null> {
    const { line1, city, state, postalCode } = form.getValues();
    if (!line1?.trim() || !city?.trim() || !state?.trim() || !postalCode?.trim()) {
      return null;
    }
    setDetecting(true);
    try {
      const result = await getPickupScheduleSuggestion(
        { line1: line1.trim(), city: city.trim(), state: state.trim(), postalCode: postalCode.trim() },
        accessToken
      );
      setSuggestion(result);
      return result;
    } catch {
      setSuggestion(null);
      return null;
    } finally {
      setDetecting(false);
    }
  }

  async function checkArea(postalCode: string): Promise<void> {
    const trimmed = postalCode.trim();
    if (!trimmed) {
      setAreaCheck(null);
      return;
    }
    setAreaChecking(true);
    try {
      // Customers create with test zones allowed, so include them in the check.
      setAreaCheck(await checkServiceArea(trimmed, { includeTest: true }));
    } catch {
      setAreaCheck(null);
    } finally {
      setAreaChecking(false);
      void detectProvider();
    }
  }

  const createMutation = useMutation({
    mutationFn: async (args: { fields: AddressFields; sug: PickupScheduleSuggestion | null }) => {
      const g = args.sug?.matched ? args.sug.garbage : undefined;
      const cans = g
        ? Math.max(1, (args.sug?.streams ?? []).filter((s) => s.dayOfWeek === g.dayOfWeek).length)
        : 2;
      const payload: CreateAddressRequest = {
        line1: args.fields.line1,
        city: args.fields.city,
        state: args.fields.state,
        postalCode: args.fields.postalCode,
        lat: 45.52,
        lng: -122.67,
        // Placeholder — the API derives the real timezone from the geocoded address.
        timezone: "America/Los_Angeles",
        accessNotes: "", // collected in step 3
        canCount: cans,
        pickupsPerWeek: 1,
        rollIn: true,
        glassRecycling: false,
        petWasteDogs: 0,
        isActive: true,
        pickupDayOfWeek: g ? g.dayOfWeek : FRIDAY,
        cadence: g ? g.cadence : "WEEKLY",
        providerSynced: Boolean(g),
        biweeklyAnchorDate: g && g.cadence === "BIWEEKLY" && g.nextDate ? g.nextDate : undefined
      };
      return createAddress(payload, accessToken);
    },
    onSuccess: async (res) => {
      setCreated(res.address);
      setManualDays(
        res.address.schedules.map((s) => ({
          dayOfWeek: s.dayOfWeek,
          cadence: s.cadence,
          canCount: s.canCount
        }))
      );
      await invalidate();
      setStep(2);
    }
  });

  // Step 2 (provider match): the review builds the schedule; save then go to notes.
  const applyMutation = useMutation({
    mutationFn: (days: PickupDayInput[]) => updateAddressSchedule(created!.id, { days }, accessToken),
    onSuccess: async () => {
      await invalidate();
      setStep(3);
    }
  });

  // Step 2 (no provider): save the manually-entered pickup days, then go to notes.
  const manualSaveMutation = useMutation({
    mutationFn: () => {
      const days: PickupDayInput[] = manualDays.map((d) => ({
        dayOfWeek: d.dayOfWeek,
        cadence: d.cadence,
        biweeklyAnchorDate: d.cadence === "BIWEEKLY" ? nextDateOfWeekday(d.dayOfWeek) : undefined,
        canCount: d.canCount,
        rollIn: true,
        glassRecycling: false,
        petWasteDogs: 0,
        providerSynced: false
      }));
      return updateAddressSchedule(created!.id, { days }, accessToken);
    },
    onSuccess: async () => {
      await invalidate();
      setStep(3);
    }
  });

  // Step 3: save access notes and finish.
  const notesMutation = useMutation({
    mutationFn: () => updateAddress(created!.id, { accessNotes: accessNotes.trim() }, accessToken),
    onSuccess: async () => {
      await invalidate();
      onDone(created!.id);
    }
  });

  const submitStep1 = form.handleSubmit(async (fields) => {
    const sug = suggestion ?? (await detectProvider());
    createMutation.mutate({ fields, sug });
  });

  // ---- Manual day editor helpers (no-provider case) ----
  const usedDays = new Set(manualDays.map((d) => d.dayOfWeek));
  const firstFreeDay = [FRIDAY, 1, 2, 3, 4, 6, 0].find((d) => !usedDays.has(d));
  const addManualDay = (): void => {
    if (firstFreeDay === undefined) return;
    setManualDays((prev) => [...prev, { dayOfWeek: firstFreeDay, cadence: "WEEKLY", canCount: 2 }]);
  };
  const updateManualDay = (idx: number, patch: Partial<ManualDay>): void =>
    setManualDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  const removeManualDay = (idx: number): void =>
    setManualDays((prev) => prev.filter((_, i) => i !== idx));

  // ================= STEP 3: access notes =================
  if (step === 3 && created) {
    return (
      <article className="panel">
        <div className="panel-head-row">
          <h3>Add a location — access notes</h3>
        </div>
        <p className="subtext">Step 3 of 3 — anything the operator should know (optional).</p>
        <label>
          Access notes
          <input
            value={accessNotes}
            onChange={(e) => setAccessNotes(e.target.value)}
            placeholder="e.g. gate code, where the cans are kept, dog in the yard"
          />
        </label>
        <div className="button-row">
          <button
            type="button"
            className="cta-primary"
            disabled={notesMutation.isPending}
            onClick={() => notesMutation.mutate()}
          >
            {notesMutation.isPending ? "Saving…" : "Finish"}
          </button>
        </div>
        {notesMutation.isError ? <p className="error">{getErrorMessage(notesMutation.error)}</p> : null}
      </article>
    );
  }

  // ================= STEP 2: pickup days =================
  if (step === 2 && created) {
    return (
      <article className="panel">
        <div className="panel-head-row">
          <h3>Add a location — pickup days</h3>
        </div>
        <p className="subtext">
          Step 2 of 3 — {created.line1}, {created.city} {created.postalCode}
        </p>
        {suggestion?.matched ? (
          <ProviderSyncReview
            providerLabel={suggestion.providerLabel}
            streams={suggestion.streams}
            pickups={created.schedules.map((s) => ({
              dayOfWeek: s.dayOfWeek,
              cadence: s.cadence,
              canCount: s.canCount,
              rollIn: s.rollIn,
              glassRecycling: s.glassRecycling,
              petWasteDogs: s.petWasteDogs,
              biweeklyAnchorDate: s.biweeklyAnchorDate
            }))}
            saving={applyMutation.isPending}
            error={applyMutation.isError ? getErrorMessage(applyMutation.error) : null}
            onApply={(days) => applyMutation.mutate(days)}
            onSkip={() => setStep(3)}
          />
        ) : (
          <>
            <p className="subtext">
              No trash provider was found for this address — add your pickup day(s) manually.
            </p>
            <ul className="pickup-day-list">
              {manualDays.map((d, idx) => (
                <li className="pickup-day-card" key={idx}>
                  <div className="field-row">
                    <label>
                      Pickup day
                      <select
                        value={d.dayOfWeek}
                        onChange={(e) => updateManualDay(idx, { dayOfWeek: Number(e.target.value) })}
                      >
                        {WEEKDAYS.map((label, value) => (
                          <option
                            key={label}
                            value={value}
                            disabled={value !== d.dayOfWeek && usedDays.has(value)}
                          >
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Cadence
                      <select
                        value={d.cadence}
                        onChange={(e) =>
                          updateManualDay(idx, { cadence: e.target.value as "WEEKLY" | "BIWEEKLY" })
                        }
                      >
                        <option value="WEEKLY">Every week</option>
                        <option value="BIWEEKLY">Every 2 weeks</option>
                      </select>
                    </label>
                    <label>
                      Cans
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={d.canCount}
                        onChange={(e) =>
                          updateManualDay(idx, {
                            canCount: Math.max(1, Math.min(20, Number(e.target.value) || 1))
                          })
                        }
                      />
                    </label>
                    {manualDays.length > 1 ? (
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => removeManualDay(idx)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <div className="button-row">
              <button
                type="button"
                className="ghost-btn"
                onClick={addManualDay}
                disabled={firstFreeDay === undefined}
              >
                + Add day
              </button>
              <button
                type="button"
                className="cta-primary"
                disabled={manualSaveMutation.isPending}
                onClick={() => manualSaveMutation.mutate()}
              >
                {manualSaveMutation.isPending ? "Saving…" : "Continue"}
              </button>
            </div>
            {manualSaveMutation.isError ? (
              <p className="error">{getErrorMessage(manualSaveMutation.error)}</p>
            ) : null}
          </>
        )}
      </article>
    );
  }

  // ================= STEP 1: address + provider =================
  return (
    <article className="panel">
      <div className="panel-head-row">
        <h3>Add a location — address</h3>
        {onCancel ? (
          <button type="button" className="link-inline" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
      <p className="subtext">Step 1 of 3 — enter the address and we'll find its trash provider.</p>
      <form onSubmit={submitStep1}>
        <label>
          Line 1
          <input
            {...form.register("line1", { required: "Street address is required" })}
            placeholder="123 Main St"
          />
        </label>
        {form.formState.errors.line1 ? (
          <p className="error">{form.formState.errors.line1.message}</p>
        ) : null}
        <label>
          City
          <input {...form.register("city", { required: "City is required" })} placeholder="Bend" />
        </label>
        {form.formState.errors.city ? (
          <p className="error">{form.formState.errors.city.message}</p>
        ) : null}
        <label>
          State
          <input
            {...form.register("state", {
              required: "State is required",
              minLength: { value: 2, message: "Use the 2-letter state code" }
            })}
            placeholder="OR"
          />
        </label>
        {form.formState.errors.state ? (
          <p className="error">{form.formState.errors.state.message}</p>
        ) : null}
        <label>
          Postal code
          <input
            {...form.register("postalCode", {
              required: "Postal code is required",
              minLength: { value: 3, message: "Enter a valid postal code" },
              onBlur: (event) => void checkArea((event.target as HTMLInputElement).value)
            })}
            placeholder="97702"
          />
        </label>
        {form.formState.errors.postalCode ? (
          <p className="error">{form.formState.errors.postalCode.message}</p>
        ) : areaChecking ? (
          <p className="subtext">Checking service area…</p>
        ) : areaCheck ? (
          <p className={areaCheck.eligible ? "success-inline" : "error"}>
            {areaCheck.eligible
              ? `✓ We service ${areaCheck.postalCode}.`
              : `✗ We don't service ${areaCheck.postalCode} yet.`}
          </p>
        ) : null}

        {detecting ? (
          <p className="subtext">Looking up your trash provider…</p>
        ) : suggestion?.matched ? (
          <div className="pickup-suggestion">
            <p>
              <strong>Trash provider: {suggestion.providerLabel}.</strong> They collect on{" "}
              {[...new Set(suggestion.streams.map((s) => WEEKDAYS[s.dayOfWeek]))].join(", ")}. You'll
              confirm and sync your pickup days next.
            </p>
          </div>
        ) : suggestion ? (
          <p className="subtext">
            No trash provider found for this address — you can add your pickup days manually next.
          </p>
        ) : null}

        <div className="button-row">
          <button type="submit" className="cta-primary" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Saving…" : "Continue"}
          </button>
        </div>
        {createMutation.isError ? <p className="error">{getErrorMessage(createMutation.error)}</p> : null}
      </form>
    </article>
  );
}
