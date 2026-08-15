import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  LocationServiceInput,
  LocationServiceView,
  PickupScheduleSuggestion,
  ScheduleCan,
  ServiceType
} from "@gpp/shared";
import {
  SERVICE_REGISTRY,
  SERVICE_TYPES_ORDER,
  flatServiceDayCents,
  formatUsd,
  weekdayMonthlyCents
} from "@gpp/shared";
import type { WeekdayPricing } from "@gpp/shared";
import { CanRowsEditor } from "./CanRowsEditor";
import { ProviderSyncReview } from "./ProviderSyncReview";
import { getLocationServices, updateLocationServices } from "../lib/api";

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-first for display/free-day picking

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Request failed";
}

// --- Draft model (service-centric state, rendered day-centric) -------------
type DraftDay = {
  dayOfWeek: number;
  cadence: "WEEKLY" | "BIWEEKLY";
  biweeklyAnchorDate: string | null;
  rollIn: boolean;
  providerSynced: boolean;
  cans: ScheduleCan[];
};
type DraftService = {
  key: string;
  type: ServiceType;
  options: Record<string, unknown>;
  days: DraftDay[];
};

function viewToDraft(v: LocationServiceView): DraftService {
  return {
    key: v.id,
    type: v.type,
    options: { ...v.options },
    days: v.days.map((d) => ({
      dayOfWeek: d.dayOfWeek,
      cadence: d.cadence,
      biweeklyAnchorDate: d.biweeklyAnchorDate,
      rollIn: d.rollIn,
      providerSynced: d.providerSynced,
      cans: d.cans
    }))
  };
}

function draftToInput(s: DraftService): LocationServiceInput {
  return {
    type: s.type,
    options: s.options,
    days: s.days.map((d) => ({
      dayOfWeek: d.dayOfWeek,
      cadence: d.cadence,
      rollIn: d.rollIn,
      providerSynced: d.providerSynced,
      cans: d.cans,
      ...(d.cadence === "BIWEEKLY"
        ? { biweeklyAnchorDate: d.biweeklyAnchorDate ?? new Date().toISOString() }
        : {})
    }))
  };
}

function newDay(type: ServiceType, dayOfWeek: number, cadence: "WEEKLY" | "BIWEEKLY"): DraftDay {
  return {
    dayOfWeek,
    cadence,
    biweeklyAnchorDate: null,
    rollIn: true,
    providerSynced: false,
    cans: type === "TRASH" ? [{ type: "TRASH", cadence, count: 1 }] : []
  };
}

function defaultOptions(type: ServiceType): Record<string, unknown> {
  if (type === "PET_WASTE") return { dogs: 1 };
  if (type === "PLANT_WATERING") return { coverage: "OUTDOOR" };
  return {};
}

function serialize(list: DraftService[]): string {
  return JSON.stringify(
    [...list]
      .sort((a, b) => a.type.localeCompare(b.type))
      .map((s) => ({
        type: s.type,
        options: s.options,
        days: [...s.days]
          .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
          .map((d) => ({
            dayOfWeek: d.dayOfWeek,
            cadence: d.cadence,
            rollIn: d.rollIn,
            providerSynced: d.providerSynced,
            cans: d.cans.map((c) => ({ type: c.type, cadence: c.cadence, count: c.count }))
          }))
      }))
  );
}

// --- Main component --------------------------------------------------------
// A location's schedule as a LIST OF DAYS. Each day card shows the cans serviced
// that day plus any other services (mail check, watering, pet waste) that fall on
// it. "+ Add service" is a wizard (Trash default). State is service-centric (to
// match the /services API) but rendered/edited day-first.
export function LocationServicesEditor({
  addressId,
  accessToken,
  connectProvider,
  onChanged
}: {
  addressId: string;
  accessToken: string;
  connectProvider?: (addressId: string, accessToken: string) => Promise<PickupScheduleSuggestion>;
  onChanged?: () => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const servicesQuery = useQuery({
    queryKey: ["location-services", addressId],
    queryFn: async () => getLocationServices(addressId, accessToken)
  });

  const loaded = servicesQuery.data?.services;
  const baseline = useMemo(() => (loaded ? serialize(loaded.map(viewToDraft)) : ""), [loaded]);

  const [drafts, setDrafts] = useState<DraftService[] | null>(null);
  const services = drafts ?? (loaded ? loaded.map(viewToDraft) : []);
  const setServices = (next: DraftService[]): void => setDrafts(next);
  const dirty = baseline !== "" && serialize(services) !== baseline;

  const [adding, setAdding] = useState(false);

  const save = useMutation({
    mutationFn: () => updateLocationServices(addressId, services.map(draftToInput), accessToken),
    onSuccess: async (res) => {
      setDrafts(res.services.map(viewToDraft));
      await queryClient.invalidateQueries({ queryKey: ["location-services", addressId] });
      onChanged?.();
    }
  });

  // --- draft operations (service-centric) ---
  const upsertServiceDay = (
    type: ServiceType,
    dayOfWeek: number,
    cadence: "WEEKLY" | "BIWEEKLY",
    options?: Record<string, unknown>
  ): void => {
    const existing = services.find((s) => s.type === type);
    if (existing) {
      if (existing.days.some((d) => d.dayOfWeek === dayOfWeek)) return;
      setServices(
        services.map((s) =>
          s.type === type
            ? { ...s, options: options ?? s.options, days: [...s.days, newDay(type, dayOfWeek, cadence)] }
            : s
        )
      );
    } else {
      setServices([
        ...services,
        {
          key: crypto.randomUUID(),
          type,
          options: options ?? defaultOptions(type),
          days: [newDay(type, dayOfWeek, cadence)]
        }
      ]);
    }
  };

  const patchDay = (type: ServiceType, dayOfWeek: number, patch: Partial<DraftDay>): void =>
    setServices(
      services.map((s) =>
        s.type === type
          ? { ...s, days: s.days.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d)) }
          : s
      )
    );

  const patchOptions = (type: ServiceType, options: Record<string, unknown>): void =>
    setServices(services.map((s) => (s.type === type ? { ...s, options } : s)));

  // Remove a single service from a weekday; drop the service if it has no days left.
  const removeServiceFromDay = (type: ServiceType, dayOfWeek: number): void =>
    setServices(
      services
        .map((s) =>
          s.type === type ? { ...s, days: s.days.filter((d) => d.dayOfWeek !== dayOfWeek) } : s
        )
        .filter((s) => s.days.length > 0)
    );

  // Move every service on `fromDay` to `toDay` (rename a whole day card's weekday).
  const moveDay = (fromDay: number, toDay: number): void =>
    setServices(
      services.map((s) => ({
        ...s,
        days: s.days.map((d) => (d.dayOfWeek === fromDay ? { ...d, dayOfWeek: toDay } : d))
      }))
    );

  const applyTrashDays = (days: DraftDay[]): void => {
    const others = services.filter((s) => s.type !== "TRASH");
    setServices([...others, { key: crypto.randomUUID(), type: "TRASH", options: {}, days }]);
  };

  // --- pivot to a day-centric view ---
  const weekdaysUsed = new Set<number>();
  services.forEach((s) => s.days.forEach((d) => weekdaysUsed.add(d.dayOfWeek)));
  const dayList = DAY_ORDER.filter((w) => weekdaysUsed.has(w));
  const trash = services.find((s) => s.type === "TRASH");

  // Per-weekday pricing: base visit fee + trash cans + each flat service's per-day fee.
  const weekdayPricing = (weekday: number): WeekdayPricing => {
    const flats = services
      .filter((s) => s.type !== "TRASH")
      .flatMap((s) => {
        const d = s.days.find((dd) => dd.dayOfWeek === weekday);
        return d ? [{ type: s.type, cadence: d.cadence }] : [];
      });
    const trashDay = trash?.days.find((d) => d.dayOfWeek === weekday);
    const anyWeekly =
      (trashDay?.cans.some((c) => c.cadence === "WEEKLY") ?? false) ||
      flats.some((f) => f.cadence === "WEEKLY");
    return {
      cadence: anyWeekly ? "WEEKLY" : "BIWEEKLY",
      trash: trashDay ? { cans: trashDay.cans, rollIn: trashDay.rollIn } : undefined,
      flats
    };
  };
  const dayPrice = (weekday: number): number => weekdayMonthlyCents(weekdayPricing(weekday));
  // The base visit fee alone (no services), for the per-day breakdown line.
  const dayBase = (weekday: number): number =>
    weekdayMonthlyCents({ cadence: weekdayPricing(weekday).cadence, flats: [] });
  const totalMonthly = dayList.reduce((sum, w) => sum + dayPrice(w), 0);

  if (servicesQuery.isLoading) return <p className="subtext">Loading schedule…</p>;

  return (
    <div className="pailpal-days">
      {dayList.length === 0 ? (
        <p className="subtext">No services yet — add the first one below.</p>
      ) : null}

      {dayList.map((weekday) => (
        <DayCard
          key={weekday}
          weekday={weekday}
          priceCents={dayPrice(weekday)}
          baseCents={dayBase(weekday)}
          usedWeekdays={weekdaysUsed}
          services={services}
          trashDay={trash?.days.find((d) => d.dayOfWeek === weekday) ?? null}
          onMoveDay={(to) => moveDay(weekday, to)}
          onPatchDay={patchDay}
          onPatchOptions={patchOptions}
          onRemoveService={(type) => removeServiceFromDay(type, weekday)}
        />
      ))}

      {trash && connectProvider ? (
        <TrashProviderSync
          trash={trash}
          addressId={addressId}
          accessToken={accessToken}
          connectProvider={connectProvider}
          onApplyDays={applyTrashDays}
        />
      ) : null}

      <div className="pailpal-days-actions">
        {adding ? (
          <AddServiceWizard
            services={services}
            onCancel={() => setAdding(false)}
            onAdd={(type, dayOfWeek, cadence, options) => {
              upsertServiceDay(type, dayOfWeek, cadence, options);
              setAdding(false);
            }}
          />
        ) : (
          <button type="button" className="cta-secondary" onClick={() => setAdding(true)}>
            + Add service
          </button>
        )}
        <span className="svc-total">{formatUsd(totalMonthly)}/mo</span>
        {dirty ? (
          <button
            type="button"
            className="cta-primary"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : baseline === "[]" ? "Save schedule" : "Update schedule"}
          </button>
        ) : null}
      </div>

      {save.isError ? <p className="error">{errMsg(save.error)}</p> : null}
    </div>
  );
}

// --- One day card ----------------------------------------------------------
function DayCard({
  weekday,
  priceCents,
  baseCents,
  usedWeekdays,
  services,
  trashDay,
  onMoveDay,
  onPatchDay,
  onPatchOptions,
  onRemoveService
}: {
  weekday: number;
  priceCents: number;
  baseCents: number;
  usedWeekdays: Set<number>;
  services: DraftService[];
  trashDay: DraftDay | null;
  onMoveDay: (to: number) => void;
  onPatchDay: (type: ServiceType, dayOfWeek: number, patch: Partial<DraftDay>) => void;
  onPatchOptions: (type: ServiceType, options: Record<string, unknown>) => void;
  onRemoveService: (type: ServiceType) => void;
}): JSX.Element {
  // Non-trash services that fall on this weekday.
  const others = services
    .filter((s) => s.type !== "TRASH" && s.days.some((d) => d.dayOfWeek === weekday))
    .map((s) => ({ service: s, day: s.days.find((d) => d.dayOfWeek === weekday) as DraftDay }));

  return (
    <div className="pailpal-day">
      <div className="pailpal-day-head">
        <div className="pailpal-day-title">
          <span className="pailpal-day-eyebrow">Service day</span>
          <select
            className="pailpal-day-select"
            aria-label="Day of the week"
            value={weekday}
            onChange={(e) => onMoveDay(Number(e.target.value))}
          >
            {DOW.map((label, idx) => (
              <option key={label} value={idx} disabled={idx !== weekday && usedWeekdays.has(idx)}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="pailpal-day-controls">
          {trashDay?.providerSynced ? (
            <span className="pailpal-day-synced">✓ Synced to provider</span>
          ) : null}
          <span className="svc-day-price">{formatUsd(priceCents)}/mo</span>
        </div>
      </div>

      <div className="pailpal-day-cans">
        {trashDay ? (
          <div className="svc-block">
            <div className="svc-block-head">
              <span className="svc-block-title">
                <span>{SERVICE_REGISTRY.TRASH.icon}</span> Trash
              </span>
              <span className="svc-block-right">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => onRemoveService("TRASH")}
                >
                  Remove
                </button>
              </span>
            </div>
            <CanRowsEditor
              title="Cans serviced"
              cans={trashDay.cans}
              onChange={(cans) => onPatchDay("TRASH", weekday, { cans })}
            />
            <label className="pailpal-rollin-row">
              <input
                type="checkbox"
                checked={trashDay.rollIn}
                onChange={(e) => onPatchDay("TRASH", weekday, { rollIn: e.target.checked })}
              />
              <span className="pailpal-rollin-text">
                Roll cans back in
                <span className="pailpal-rollin-hint">We return the carts after the hauler collects.</span>
              </span>
            </label>
          </div>
        ) : null}

        {others.map(({ service, day }) => {
          const reg = SERVICE_REGISTRY[service.type];
          return (
            <div className="svc-block" key={service.type}>
              <div className="svc-block-head">
                <span className="svc-block-title">
                  <span>{reg.icon}</span> {reg.label}
                </span>
                <span className="svc-block-right">
                  {reg.flatPriceCents !== null
                    ? `${formatUsd(flatServiceDayCents(service.type, day.cadence))}/mo`
                    : ""}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => onRemoveService(service.type)}
                  >
                    Remove
                  </button>
                </span>
              </div>
              <div className="svc-block-body">
                <label className="svc-day-field">
                  Cadence
                  <select
                    value={day.cadence}
                    onChange={(e) =>
                      onPatchDay(service.type, weekday, {
                        cadence: e.target.value as "WEEKLY" | "BIWEEKLY"
                      })
                    }
                  >
                    <option value="WEEKLY">Every week</option>
                    <option value="BIWEEKLY">Every 2 weeks</option>
                  </select>
                </label>
                <ServiceOptionsForm
                  type={service.type}
                  options={service.options}
                  onChange={(options) => onPatchOptions(service.type, options)}
                />
              </div>
            </div>
          );
        })}

        <div className="svc-base-line">
          <span>Base visit fee</span>
          <span>{formatUsd(baseCents)}/mo</span>
        </div>
      </div>
    </div>
  );
}

// --- Add-service wizard ----------------------------------------------------
function AddServiceWizard({
  services,
  onAdd,
  onCancel
}: {
  services: DraftService[];
  onAdd: (
    type: ServiceType,
    dayOfWeek: number,
    cadence: "WEEKLY" | "BIWEEKLY",
    options?: Record<string, unknown>
  ) => void;
  onCancel: () => void;
}): JSX.Element {
  const [type, setType] = useState<ServiceType | null>(null);

  if (!type) {
    return (
      <div className="svc-picker">
        <div className="svc-picker-head">
          <strong>Choose a service</strong>
          <button type="button" className="link-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <div className="svc-picker-grid">
          {SERVICE_TYPES_ORDER.map((t) => {
            const reg = SERVICE_REGISTRY[t];
            return (
              <button
                key={t}
                type="button"
                className="svc-picker-option"
                onClick={() => setType(t)}
              >
                <span className="svc-picker-icon">{reg.icon}</span>
                <span className="svc-picker-label">{reg.label}</span>
                <span className="svc-picker-desc">{reg.description}</span>
                <span className="svc-picker-price">
                  {reg.flatPriceCents !== null ? `${formatUsd(reg.flatPriceCents)}/mo` : "Priced by cans"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <ConfigureServiceStep
      type={type}
      services={services}
      onBack={() => setType(null)}
      onCancel={onCancel}
      onAdd={onAdd}
    />
  );
}

function ConfigureServiceStep({
  type,
  services,
  onBack,
  onCancel,
  onAdd
}: {
  type: ServiceType;
  services: DraftService[];
  onBack: () => void;
  onCancel: () => void;
  onAdd: (
    type: ServiceType,
    dayOfWeek: number,
    cadence: "WEEKLY" | "BIWEEKLY",
    options?: Record<string, unknown>
  ) => void;
}): JSX.Element {
  const reg = SERVICE_REGISTRY[type];
  const existing = services.find((s) => s.type === type);
  const usedForType = new Set(existing?.days.map((d) => d.dayOfWeek) ?? []);
  const firstFree = DAY_ORDER.find((d) => !usedForType.has(d)) ?? 2;

  const [dayOfWeek, setDayOfWeek] = useState<number>(firstFree);
  const [cadence, setCadence] = useState<"WEEKLY" | "BIWEEKLY">("WEEKLY");
  const [options, setOptions] = useState<Record<string, unknown>>(
    existing ? { ...existing.options } : defaultOptions(type)
  );

  return (
    <div className="svc-picker">
      <div className="svc-picker-head">
        <strong>
          {reg.icon} {reg.label}
        </strong>
        <div>
          <button type="button" className="link-btn" onClick={onBack}>
            Back
          </button>{" "}
          <button type="button" className="link-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>

      <div className="svc-configure">
        <label className="svc-day-field">
          Day
          <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
            {DOW.map((label, idx) => (
              <option key={label} value={idx} disabled={usedForType.has(idx)}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {type !== "TRASH" ? (
          <label className="svc-day-field">
            Cadence
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value as "WEEKLY" | "BIWEEKLY")}
            >
              <option value="WEEKLY">Every week</option>
              <option value="BIWEEKLY">Every 2 weeks</option>
            </select>
          </label>
        ) : null}
        {type !== "TRASH" ? (
          <ServiceOptionsForm type={type} options={options} onChange={setOptions} />
        ) : null}
      </div>

      <button
        type="button"
        className="cta-primary"
        onClick={() => onAdd(type, dayOfWeek, cadence, options)}
      >
        Add to schedule
      </button>
    </div>
  );
}

// --- Per-type options form -------------------------------------------------
function ServiceOptionsForm({
  type,
  options,
  onChange
}: {
  type: ServiceType;
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}): JSX.Element | null {
  const set = (patch: Record<string, unknown>): void => onChange({ ...options, ...patch });

  if (type === "PET_WASTE") {
    return (
      <div className="svc-options">
        <label className="svc-day-field">
          Dogs
          <input
            type="number"
            min={1}
            max={20}
            value={typeof options.dogs === "number" ? options.dogs : 1}
            onChange={(e) => set({ dogs: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
          />
        </label>
        <label className="svc-options-notes">
          Instructions
          <textarea
            rows={2}
            value={typeof options.instructions === "string" ? options.instructions : ""}
            onChange={(e) => set({ instructions: e.target.value })}
            placeholder="Gate code, where the dogs are, etc."
          />
        </label>
      </div>
    );
  }
  if (type === "PLANT_WATERING") {
    return (
      <div className="svc-options">
        <label className="svc-day-field">
          Coverage
          <select
            value={typeof options.coverage === "string" ? options.coverage : "OUTDOOR"}
            onChange={(e) => set({ coverage: e.target.value })}
          >
            <option value="OUTDOOR">Outdoor</option>
            <option value="INDOOR">Indoor</option>
            <option value="BOTH">Indoor & outdoor</option>
          </select>
        </label>
        <label className="svc-options-notes">
          Instructions
          <textarea
            rows={2}
            value={typeof options.instructions === "string" ? options.instructions : ""}
            onChange={(e) => set({ instructions: e.target.value })}
            placeholder="Which plants, how much water, etc."
          />
        </label>
      </div>
    );
  }
  if (type === "MAIL_CHECK") {
    return (
      <div className="svc-options">
        <label className="svc-options-notes">
          Instructions
          <textarea
            rows={2}
            value={typeof options.instructions === "string" ? options.instructions : ""}
            onChange={(e) => set({ instructions: e.target.value })}
            placeholder="Bring the mail from the mailbox to the front door."
          />
        </label>
      </div>
    );
  }
  return null;
}

// --- Trash provider sync ---------------------------------------------------
function TrashProviderSync({
  trash,
  addressId,
  accessToken,
  connectProvider,
  onApplyDays
}: {
  trash: DraftService;
  addressId: string;
  accessToken: string;
  connectProvider: (addressId: string, accessToken: string) => Promise<PickupScheduleSuggestion>;
  onApplyDays: (days: DraftDay[]) => void;
}): JSX.Element {
  const [result, setResult] = useState<PickupScheduleSuggestion | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const sync = useMutation({
    mutationFn: () => connectProvider(addressId, accessToken),
    onSuccess: (r) => {
      setResult(r);
      setReviewing(r.matched);
    }
  });

  const synced = trash.days.some((d) => d.providerSynced);
  const noMatch = sync.isSuccess && result !== null && !result.matched && !reviewing;

  return (
    <div className="svc-sync">
      <button type="button" className="ghost-btn" disabled={sync.isPending} onClick={() => sync.mutate()}>
        {sync.isPending ? "Syncing…" : synced ? "Re-sync with trash provider" : "Sync with trash provider"}
      </button>
      {sync.isError ? <span className="error">{errMsg(sync.error)}</span> : null}
      {noMatch ? <span className="subtext">No trash provider matched this address.</span> : null}

      {reviewing && result?.matched ? (
        <ProviderSyncReview
          providerLabel={result.providerLabel}
          streams={result.streams}
          pickups={trash.days.map((d) => ({
            dayOfWeek: d.dayOfWeek,
            cans: d.cans.length > 0 ? d.cans : [{ type: "TRASH", cadence: "WEEKLY", count: 1 }],
            rollIn: d.rollIn,
            petWasteDogs: 0,
            biweeklyAnchorDate: d.biweeklyAnchorDate ?? undefined
          }))}
          saving={false}
          error={null}
          onApply={(payload) => {
            onApplyDays(
              payload.map((p) => ({
                dayOfWeek: p.dayOfWeek,
                cadence: (p.cadence ?? "WEEKLY") as "WEEKLY" | "BIWEEKLY",
                biweeklyAnchorDate: p.biweeklyAnchorDate ?? null,
                rollIn: p.rollIn ?? true,
                providerSynced: p.providerSynced ?? false,
                cans: p.cans
              }))
            );
            setReviewing(false);
            setResult(null);
          }}
          onSkip={() => setReviewing(false)}
        />
      ) : null}
    </div>
  );
}
