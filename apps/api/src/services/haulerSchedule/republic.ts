import type { HaulerUpcomingPickup, PickupScheduleSuggestion, PickupStream } from "@gpp/shared";
import type {
  HaulerLookupInput,
  HaulerProvider,
  ProviderResult,
  UpcomingPickupsRequest
} from "./types";

const DAY_MS = 86_400_000;

// Republic Services (a large national US hauler) exposes open, unauthenticated
// JSON endpoints behind its public schedule lookup. Flow: resolve address ->
// addressHash (also geocodes), then publicPickup -> residential containers ->
// normalize. Called server-side (no CORS header on these endpoints).
const API_ROOT = "https://www.republicservices.com";
const LOOKUP_TIMEOUT_MS = 4000;

// Sun..Sat order matching JS getDay / ServiceSchedule.pickupDayOfWeek, aligned to
// Republic's per-weekday pickup-count fields.
const WEEKDAY_FIELDS = [
  "sundayPickups",
  "mondayPickups",
  "tuesdayPickups",
  "wednesdayPickups",
  "thursdayPickups",
  "fridayPickups",
  "saturdayPickups"
] as const;

type AddressMatch = {
  addressHash?: string;
  matchConfidenceScore?: string;
  isCloseMatch?: string;
  latitude?: number;
  longitude?: number;
};

type Container = {
  productDescription?: string;
  wasteTypeDescription?: string;
  numberOfPickupsPeriodLength?: number;
  numberOfPickupsPeriodUnit?: string;
  nextServiceDays?: string[];
} & Partial<Record<(typeof WEEKDAY_FIELDS)[number], number>>;

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchResidential(addressHash: string): Promise<Container[]> {
  const url = `${API_ROOT}/api/v1/publicPickup?siteAddressHash=${encodeURIComponent(addressHash)}`;
  const payload = (await fetchJson(url)) as { data?: { residential?: Container[] } | null } | null;
  const residential = payload?.data?.residential;
  return Array.isArray(residential) ? residential : [];
}

type Holiday = { date: string; delayDays: number; cancelled: boolean };

// Parse Republic's holiday impact string into a concrete effect.
function parseImpact(schedule: string): { delayDays: number; cancelled: boolean } {
  const s = schedule.toLowerCase();
  if (s.includes("no service") || s.includes("no pickup") || s.includes("no collection")) {
    return { delayDays: 0, cancelled: true };
  }
  if (s.includes("two day") || s.includes("2 day")) {
    return { delayDays: 2, cancelled: false };
  }
  if (s.includes("one day") || s.includes("1 day")) {
    return { delayDays: 1, cancelled: false };
  }
  return { delayDays: 0, cancelled: false };
}

async function fetchHolidays(lat: number, lng: number): Promise<Holiday[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_ROOT}/api/v2/holidaySchedules/schedule`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ latitude: lat, longitude: lng, lobs: ["residential"] })
    });
    if (!response.ok) {
      return [];
    }
    const payload = (await response.json()) as {
      data?: Array<{ date?: string; holidaySchedule?: string; serviceImpacted?: boolean }>;
    };
    const rows = payload.data ?? [];
    return rows
      .filter((r) => r.date && r.serviceImpacted)
      .map((r) => {
        const impact = parseImpact(r.holidaySchedule ?? "");
        return { date: r.date!.slice(0, 10), delayDays: impact.delayDays, cancelled: impact.cancelled };
      });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// UTC midnight Date for a "YYYY-MM-DD" string.
function dateOf(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Monday-start week key so a holiday earlier in the week can delay later pickups.
function weekStartMonday(date: Date): number {
  const d = new Date(date);
  const offset = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return d.getTime() - offset * DAY_MS;
}

function classify(wasteType: string, product: string): PickupStream["kind"] | null {
  const w = wasteType.toLowerCase();
  const p = product.toLowerCase();
  // Bulk/on-call service isn't a regular pickup day — ignore it.
  if (p.includes("bulk")) {
    return null;
  }
  if (w.includes("recycl") || p.includes("recycl")) {
    return "RECYCLING";
  }
  if (w.includes("yard") || w.includes("green") || w.includes("organic") || p.includes("yard")) {
    return "YARD";
  }
  if (w.includes("waste") || w.includes("trash") || w.includes("refuse") || p.includes("waste")) {
    return "GARBAGE";
  }
  return null;
}

const FRIENDLY_LABEL: Record<PickupStream["kind"], string> = {
  GARBAGE: "Trash",
  RECYCLING: "Recycling",
  YARD: "Yard waste",
  OTHER: "Pickup"
};

function cadenceOf(length: number | undefined, unit: string | undefined): "WEEKLY" | "BIWEEKLY" {
  const u = (unit ?? "").toUpperCase();
  if (u.startsWith("W")) {
    return (length ?? 1) >= 2 ? "BIWEEKLY" : "WEEKLY";
  }
  // Non-weekly units (e.g. monthly) are rare for residential; approximate as
  // biweekly so we don't mislabel a less-frequent service as weekly.
  return "BIWEEKLY";
}

// UTC weekday (0=Sun..6=Sat) of a "YYYY-MM-DD" string.
function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

// Prefer the next scheduled date's weekday; fall back to the per-weekday flags.
function resolveWeekday(container: Container): { dayOfWeek: number; nextDate?: string } | null {
  const next = container.nextServiceDays?.find(Boolean);
  if (next) {
    return { dayOfWeek: weekdayOf(next), nextDate: `${next.slice(0, 10)}T00:00:00.000Z` };
  }
  const idx = WEEKDAY_FIELDS.findIndex((field) => (container[field] ?? 0) > 0);
  return idx >= 0 ? { dayOfWeek: idx } : null;
}

function toStreams(containers: Container[]): PickupStream[] {
  type Candidate = PickupStream & { sortKey: string };
  const byKind = new Map<PickupStream["kind"], Candidate>();

  for (const container of containers) {
    const kind = classify(container.wasteTypeDescription ?? "", container.productDescription ?? "");
    if (!kind) {
      continue;
    }
    const when = resolveWeekday(container);
    if (!when) {
      continue;
    }
    const candidate: Candidate = {
      kind,
      label: FRIENDLY_LABEL[kind],
      dayOfWeek: when.dayOfWeek,
      cadence: cadenceOf(container.numberOfPickupsPeriodLength, container.numberOfPickupsPeriodUnit),
      nextDate: when.nextDate,
      // Sort so the earliest upcoming pickup wins when a kind has >1 container.
      sortKey: when.nextDate ?? `zzz-${when.dayOfWeek}`
    };
    const existing = byKind.get(kind);
    if (!existing || candidate.sortKey < existing.sortKey) {
      byKind.set(kind, candidate);
    }
  }

  return [...byKind.values()].map(({ sortKey: _sortKey, ...stream }) => stream);
}

export type RepublicConfig = {
  id: string;
  label: string;
  serves: (input: HaulerLookupInput) => boolean;
};

export function createRepublicProvider(config: RepublicConfig): HaulerProvider {
  return {
    id: config.id,
    label: config.label,
    serves: config.serves,
    async lookup(input: HaulerLookupInput): Promise<ProviderResult | null> {
      // 1. Resolve the one-line address to Republic's addressHash.
      const oneLine = `${input.line1}, ${input.city}, ${input.state} ${input.postalCode}`;
      const addressUrl = `${API_ROOT}/api/v1/addresses?addressLine1=${encodeURIComponent(oneLine)}`;
      const addressPayload = (await fetchJson(addressUrl)) as { data?: AddressMatch[] } | AddressMatch[] | null;
      const matches = Array.isArray(addressPayload) ? addressPayload : (addressPayload?.data ?? []);
      const match = matches.find((m) => m.addressHash) ?? null;
      if (!match?.addressHash) {
        return null;
      }

      // 2. Pull the pickup schedule for that address; residential containers only.
      const residential = await fetchResidential(match.addressHash);
      if (residential.length === 0) {
        // Address isn't serviced by Republic (e.g. covered by another hauler).
        return null;
      }

      const streams = toStreams(residential);
      const garbage = streams.find((s) => s.kind === "GARBAGE");
      const recycling = streams.find((s) => s.kind === "RECYCLING");

      const suggestion: PickupScheduleSuggestion = {
        matched: Boolean(garbage),
        provider: config.id,
        providerLabel: config.label,
        garbage,
        recycling,
        streams
      };
      if (!suggestion.matched) {
        return null;
      }
      const coords =
        typeof match.latitude === "number" && typeof match.longitude === "number"
          ? { lat: match.latitude, lng: match.longitude }
          : undefined;
      return { externalId: match.addressHash, coords, suggestion };
    },

    async getUpcomingPickups(req: UpcomingPickupsRequest): Promise<HaulerUpcomingPickup[] | null> {
      const residential = await fetchResidential(req.externalId);
      if (residential.length === 0) {
        return null;
      }
      // Republic doesn't return dated events, so project each container's cadence
      // across the window from a known on-cycle seed date, then apply holidays.
      const holidays =
        req.lat !== undefined && req.lng !== undefined ? await fetchHolidays(req.lat, req.lng) : [];
      const from = dateOf(req.from);
      const to = dateOf(req.to);

      const pickups: HaulerUpcomingPickup[] = [];
      for (const container of residential) {
        const kind = classify(container.wasteTypeDescription ?? "", container.productDescription ?? "");
        if (!kind || kind === "OTHER") {
          continue;
        }
        const stepDays =
          cadenceOf(container.numberOfPickupsPeriodLength, container.numberOfPickupsPeriodUnit) === "BIWEEKLY"
            ? 14
            : 7;
        const seedStr = container.nextServiceDays?.find(Boolean);
        if (!seedStr) {
          continue;
        }
        // Walk the seed back to the window start, then forward across the window.
        let cursor = dateOf(seedStr.slice(0, 10));
        while (cursor.getTime() - stepDays * DAY_MS >= from.getTime()) {
          cursor = new Date(cursor.getTime() - stepDays * DAY_MS);
        }
        for (; cursor.getTime() <= to.getTime(); cursor = new Date(cursor.getTime() + stepDays * DAY_MS)) {
          if (cursor.getTime() < from.getTime()) {
            continue;
          }
          // Apply the largest same-week holiday delay whose holiday falls on or
          // before this pickup's weekday (the standard cascade rule).
          const week = weekStartMonday(cursor);
          const inWeek = holidays.filter(
            (h) => weekStartMonday(dateOf(h.date)) === week && dateOf(h.date).getTime() <= cursor.getTime()
          );
          if (inWeek.some((h) => h.cancelled)) {
            continue; // No collection this week — leave a gap the scheduler treats as a skip.
          }
          const delay = inWeek.reduce((max, h) => Math.max(max, h.delayDays), 0);
          const effective = delay > 0 ? new Date(cursor.getTime() + delay * DAY_MS) : cursor;
          pickups.push({ date: isoDay(effective), kind });
        }
      }
      return pickups;
    }
  };
}
