import type { PickupScheduleSuggestion, PickupStream } from "@gpp/shared";
import type { HaulerLookupInput, HaulerProvider, ProviderResult } from "./types";

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
      const pickupUrl = `${API_ROOT}/api/v1/publicPickup?siteAddressHash=${encodeURIComponent(match.addressHash)}`;
      const pickupPayload = (await fetchJson(pickupUrl)) as
        | { data?: { residential?: Container[] } | null }
        | null;
      const residential = pickupPayload?.data?.residential ?? [];
      if (!Array.isArray(residential) || residential.length === 0) {
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
      return { externalId: match.addressHash, suggestion };
    }
  };
}
