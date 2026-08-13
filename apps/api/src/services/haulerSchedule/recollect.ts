import type { HaulerUpcomingPickup, PickupScheduleSuggestion, PickupStream } from "@gpp/shared";
import type {
  HaulerLookupInput,
  HaulerProvider,
  ProviderResult,
  UpcomingPickupsRequest
} from "./types";

// ReCollect (a RouteWare product) powers the pickup-schedule widget/app for many
// North American haulers, including Cascade Disposal. The endpoints below are
// undocumented but open (no key/auth) and return no CORS header, so they must be
// called server-side. Flow: address-suggest -> place_id -> events -> normalize.
const API_ROOT = "https://api.recollect.net";
const LOOKUP_TIMEOUT_MS = 4000;
// How far ahead to pull events; enough to observe two cycles of a biweekly
// stream so we can infer cadence from the gap when `freq` is missing.
const WINDOW_DAYS = 35;

export type RecollectConfig = {
  id: string;
  label: string;
  // ReCollect area slug, e.g. "cascadedisposal".
  area: string;
  // Service segment used in the address-suggest path, e.g. "waste".
  service: string;
  // Numeric service id used in the events path, e.g. 399.
  serviceId: number;
  // Human-readable coverage scope for the admin registry (e.g. "Oregon").
  coverageLabel: string;
  serves: (input: HaulerLookupInput) => boolean;
};

type SuggestItem = {
  place_id?: string;
  type?: string;
  name?: string;
  // Some ReCollect areas assign different service ids to different parcels
  // (collection zones/programs), so the suggest result is authoritative.
  service_id?: number;
};

// We store `${place_id}::${serviceId}` as the externalId so a later refresh uses
// the parcel's own service id. Legacy rows are a bare place_id.
function encodeExternalId(placeId: string, serviceId: number): string {
  return `${placeId}::${serviceId}`;
}

function decodeExternalId(externalId: string, fallbackServiceId: number): { placeId: string; serviceId: number } {
  const [placeId, sid] = externalId.split("::");
  const parsed = sid ? Number(sid) : NaN;
  return { placeId: placeId ?? externalId, serviceId: Number.isFinite(parsed) ? parsed : fallbackServiceId };
}

type RepeatData = { repeat_data?: { frequency?: string } };
type RecollectEvent = {
  day?: string;
  flags?: Array<{ name?: string; subject?: string; event_type?: string }>;
  // Cadence lives in different places across ReCollect areas: some expose
  // `options.freq` ("every-week"/"A-week"/"B-week"), others put a human phrase in
  // `repeat_data.frequency` ("weekly"/"every two weeks"). Read both.
  options?: ({ freq?: string } & RepeatData) | null;
  opts?: RepeatData | null;
};

function extractFreq(event: RecollectEvent): string | undefined {
  return (
    event.options?.freq ??
    event.options?.repeat_data?.frequency ??
    event.opts?.repeat_data?.frequency ??
    undefined
  );
}

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
    // Timeout / network / parse error — treat as "no result" so the caller
    // falls back to manual entry.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Fetch normalized pickup events for a place over a date window. ReCollect's
// event dates already reflect holiday shifts, so the returned dates are truth.
async function fetchEvents(
  placeId: string,
  serviceId: number,
  after: string,
  before: string
): Promise<RecollectEvent[]> {
  const url =
    `${API_ROOT}/api/places/${placeId}/services/${serviceId}/events` +
    `?nomerge=1&hide=reminder_only&after=${after}&before=${before}&locale=en-US`;
  const payload = await fetchJson(url);
  return Array.isArray(payload)
    ? (payload as RecollectEvent[])
    : ((payload as { events?: RecollectEvent[] } | null)?.events ?? []);
}

function classify(name: string): PickupStream["kind"] {
  const n = name.toLowerCase();
  if (n.includes("garbage") || n.includes("trash") || n.includes("refuse")) {
    return "GARBAGE";
  }
  if (n.includes("recycl")) {
    return "RECYCLING";
  }
  if (n.includes("yard") || n.includes("green") || n.includes("compost") || n.includes("organic")) {
    return "YARD";
  }
  return "OTHER";
}

function cadenceFromFreq(freq: string | undefined): "WEEKLY" | "BIWEEKLY" | null {
  if (!freq) {
    return null;
  }
  const f = freq.toLowerCase();
  if (f.includes("every-week") || f === "week" || f.includes("weekly")) {
    return "WEEKLY";
  }
  // ReCollect uses "A-week"/"B-week" for the two alternating biweekly cohorts;
  // other areas spell it out ("every two weeks"/"every other week").
  if (
    f.includes("a-week") ||
    f.includes("b-week") ||
    f.includes("biweek") ||
    f.includes("2-week") ||
    f.includes("two week") ||
    f.includes("other week")
  ) {
    return "BIWEEKLY";
  }
  return null;
}

// UTC weekday (0=Sun..6=Sat) of a "YYYY-MM-DD" date string.
function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

type RawOccurrence = { kind: PickupStream["kind"]; label: string; day: string; freq?: string };

function toStreams(events: RecollectEvent[]): PickupStream[] {
  const occurrences: RawOccurrence[] = [];
  for (const event of events) {
    if (!event.day) {
      continue;
    }
    for (const flag of event.flags ?? []) {
      if (flag.event_type && flag.event_type !== "pickup") {
        continue;
      }
      const rawName = flag.name ?? flag.subject ?? "";
      if (!rawName) {
        continue;
      }
      occurrences.push({
        kind: classify(rawName),
        label: flag.subject ?? flag.name ?? rawName,
        day: event.day,
        freq: extractFreq(event)
      });
    }
  }

  const byKind = new Map<PickupStream["kind"], RawOccurrence[]>();
  for (const occ of occurrences) {
    const list = byKind.get(occ.kind) ?? [];
    list.push(occ);
    byKind.set(occ.kind, list);
  }

  const streams: PickupStream[] = [];
  for (const [kind, list] of byKind) {
    list.sort((a, b) => a.day.localeCompare(b.day));
    const first = list[0]!;
    // Prefer the explicit freq flag; fall back to the gap between the first two
    // occurrences (>= ~13 days => biweekly); default weekly.
    let cadence = cadenceFromFreq(first.freq);
    if (!cadence && list.length >= 2) {
      const gapDays =
        (new Date(`${list[1]!.day}T00:00:00Z`).getTime() - new Date(`${first.day}T00:00:00Z`).getTime()) /
        86_400_000;
      cadence = gapDays >= 13 ? "BIWEEKLY" : "WEEKLY";
    }
    streams.push({
      kind,
      label: first.label,
      dayOfWeek: weekdayOf(first.day),
      cadence: cadence ?? "WEEKLY",
      nextDate: `${first.day}T00:00:00.000Z`
    });
  }
  return streams;
}

export function createRecollectProvider(config: RecollectConfig): HaulerProvider {
  return {
    id: config.id,
    label: config.label,
    platform: "ReCollect",
    coverageLabel: config.coverageLabel,
    serves: config.serves,
    async lookup(input: HaulerLookupInput): Promise<ProviderResult | null> {
      // 1. Resolve the address to a ReCollect place_id. The suggest endpoint is a
      //    Mapbox-style prefix autocomplete scoped to this hauler's area — it only
      //    matches the street line, so appending city/state makes it return
      //    nothing. Query with line1 alone, then prefer a result whose label
      //    mentions the city (disambiguates same-named streets).
      const query = encodeURIComponent(input.line1.trim());
      const suggestUrl = `${API_ROOT}/api/areas/${config.area}/services/${config.service}/address-suggest?q=${query}&locale=en-US`;
      const suggestions = (await fetchJson(suggestUrl)) as SuggestItem[] | null;
      if (!Array.isArray(suggestions) || suggestions.length === 0) {
        return null;
      }
      const withPlace = suggestions.filter((s) => s.place_id);
      const city = input.city.trim().toLowerCase();
      const match =
        withPlace.find((s) => (s.name ?? "").toLowerCase().includes(city)) ?? withPlace[0] ?? null;
      if (!match?.place_id) {
        return null;
      }

      // 2. Pull the calendar events for that place and normalize to streams.
      // Use the parcel's own service id (from the suggest result) when present.
      const serviceId = match.service_id ?? config.serviceId;
      const now = new Date();
      const after = now.toISOString().slice(0, 10);
      const before = new Date(now.getTime() + WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
      const events = await fetchEvents(match.place_id, serviceId, after, before);

      const streams = toStreams(events);
      const garbage = streams.find((s) => s.kind === "GARBAGE");
      const recycling = streams.find((s) => s.kind === "RECYCLING");

      // We can only confidently pre-fill the (trash) first pickup day if we found
      // a garbage stream.
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
      return { externalId: encodeExternalId(match.place_id, serviceId), suggestion };
    },

    async getUpcomingPickups(req: UpcomingPickupsRequest): Promise<HaulerUpcomingPickup[] | null> {
      const { placeId, serviceId } = decodeExternalId(req.externalId, config.serviceId);
      const events = await fetchEvents(placeId, serviceId, req.from, req.to);
      if (events.length === 0) {
        return null;
      }
      const pickups: HaulerUpcomingPickup[] = [];
      for (const event of events) {
        if (!event.day) {
          continue;
        }
        for (const flag of event.flags ?? []) {
          if (flag.event_type && flag.event_type !== "pickup") {
            continue;
          }
          const name = flag.name ?? flag.subject ?? "";
          if (!name) {
            continue;
          }
          pickups.push({ date: event.day, kind: classify(name) });
        }
      }
      return pickups;
    }
  };
}
