import { prisma } from "@gpp/db";
import { Prisma } from "@prisma/client";
import {
  haulerUpcomingSchema,
  pickupScheduleSuggestionSchema,
  type HaulerUpcoming,
  type PickupScheduleSuggestion
} from "@gpp/shared";
import type { HaulerLookupInput, HaulerProvider } from "./types";
import { createRecollectProvider } from "./recollect";
import { createRepublicProvider } from "./republic";

// Cached matches are reused for a week; hauler schedules change rarely and this
// keeps us off the third-party APIs on repeat loads of the same address.
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// How far ahead to fetch concrete pickup dates. Comfortably exceeds the
// scheduler lookahead so a single refresh covers it for weeks.
const UPCOMING_WINDOW_DAYS = 45;
const DAY_MS = 86_400_000;

const EMPTY: PickupScheduleSuggestion = { matched: false, streams: [] };

// Registered haulers, tried in order (first match wins). Cascade (ReCollect) is
// region-scoped to Oregon; Republic is a large national hauler, so we probe it
// everywhere and let its own coverage decide. Additional ReCollect haulers are
// one more createRecollectProvider entry.
const PROVIDERS: HaulerProvider[] = [
  createRecollectProvider({
    id: "cascade",
    label: "Cascade Disposal",
    area: "cascadedisposal",
    service: "waste",
    serviceId: 399,
    coverageLabel: "Oregon",
    // Cascade serves the Bend / Deschutes County area (Central Oregon).
    serves: (input) => input.state.trim().toUpperCase() === "OR"
  }),
  createRecollectProvider({
    id: "richland",
    label: "Richland County Solid Waste",
    area: "Richland",
    service: "waste",
    serviceId: 325,
    coverageLabel: "South Carolina",
    // Richland County (Columbia, SC) solid waste, on ReCollect.
    serves: (input) => input.state.trim().toUpperCase() === "SC"
  }),
  createRepublicProvider({
    id: "republic",
    label: "Republic Services",
    coverageLabel: "National (US)",
    // National hauler — probe for any US address; publicPickup returns nothing
    // for addresses Republic doesn't service.
    serves: () => true
  })
];

// The wired provider registry, for the super-admin coverage view.
export function describeProviders(): Array<{
  id: string;
  label: string;
  platform: string;
  coverageLabel: string;
}> {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    platform: p.platform,
    coverageLabel: p.coverageLabel
  }));
}

// Which registered providers are configured to cover a given state (by their
// serves() region rule). Empty/unknown state -> only national providers qualify.
export function providersForState(state: string | null | undefined): Array<{ id: string; label: string }> {
  const probe: HaulerLookupInput = { line1: "", city: "", state: state ?? "", postalCode: "" };
  return PROVIDERS.filter((p) => p.serves(probe)).map((p) => ({ id: p.id, label: p.label }));
}

// Super-admin coverage overview: the wired providers plus, per service area
// (zone), which providers are configured for it and how many active addresses
// have actually matched a hauler lookup (empirical, from the cache).
export async function getHaulerCoverage(): Promise<{
  providers: ReturnType<typeof describeProviders>;
  areas: Array<{
    zoneId: string | null;
    name: string;
    city: string | null;
    state: string | null;
    isTest: boolean;
    configuredProviders: Array<{ id: string; label: string }>;
    totalAddresses: number;
    matched: number;
    unmatched: number;
    matchedByProvider: Array<{ provider: string; providerLabel: string; count: number }>;
  }>;
}> {
  const providers = describeProviders();
  const labelFor = (id: string) => providers.find((p) => p.id === id)?.label ?? id;

  const [rows, addresses, zones] = await Promise.all([
    prisma.haulerScheduleLookup.findMany({
      where: { matched: true },
      select: { addressHash: true, provider: true }
    }),
    prisma.serviceAddress.findMany({
      where: { isActive: true },
      select: {
        line1: true,
        city: true,
        state: true,
        postalCode: true,
        neighborhood: { select: { zoneId: true } }
      }
    }),
    prisma.zone.findMany({ orderBy: { name: "asc" } })
  ]);

  const providerByHash = new Map(rows.map((r) => [r.addressHash, r.provider]));

  type Bucket = {
    zoneId: string | null;
    name: string;
    city: string | null;
    state: string | null;
    isTest: boolean;
    total: number;
    matched: number;
    byProvider: Map<string, number>;
  };
  const NONE = "__none__";
  const buckets = new Map<string, Bucket>();
  for (const z of zones) {
    buckets.set(z.id, {
      zoneId: z.id,
      name: z.name,
      city: z.city,
      state: z.state,
      isTest: z.isTest,
      total: 0,
      matched: 0,
      byProvider: new Map()
    });
  }
  buckets.set(NONE, {
    zoneId: null,
    name: "No service area",
    city: null,
    state: null,
    isTest: false,
    total: 0,
    matched: 0,
    byProvider: new Map()
  });

  for (const address of addresses) {
    const key = address.neighborhood?.zoneId ?? NONE;
    const bucket = buckets.get(key) ?? buckets.get(NONE)!;
    bucket.total += 1;
    const provider = providerByHash.get(
      haulerAddressHash({
        line1: address.line1,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode
      })
    );
    if (provider) {
      bucket.matched += 1;
      bucket.byProvider.set(provider, (bucket.byProvider.get(provider) ?? 0) + 1);
    }
  }

  const areas = [...buckets.values()]
    // Show every real zone; only show the catch-all bucket when it has addresses.
    .filter((b) => b.zoneId !== null || b.total > 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((b) => ({
      zoneId: b.zoneId,
      name: b.name,
      city: b.city,
      state: b.state,
      isTest: b.isTest,
      configuredProviders: providersForState(b.state),
      totalAddresses: b.total,
      matched: b.matched,
      unmatched: b.total - b.matched,
      matchedByProvider: [...b.byProvider.entries()].map(([provider, count]) => ({
        provider,
        providerLabel: labelFor(provider),
        count
      }))
    }));

  return { providers, areas };
}

function providerById(id: string): HaulerProvider | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Normalized, order-stable key so the same address maps to one cache row across
// users and minor whitespace/case differences.
export function haulerAddressHash(input: HaulerLookupInput): string {
  return [input.line1, input.city, input.state, input.postalCode]
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

// Fetch concrete holiday-accurate pickup dates from a provider and persist them
// on the cache row. Returns the window, or null if the provider had nothing.
async function fetchAndStoreUpcoming(
  addressHash: string,
  provider: HaulerProvider,
  externalId: string,
  coords: { lat?: number | null; lng?: number | null }
): Promise<HaulerUpcoming | null> {
  const now = new Date();
  const from = isoDay(now);
  const to = isoDay(new Date(now.getTime() + UPCOMING_WINDOW_DAYS * DAY_MS));
  const pickups = await provider
    .getUpcomingPickups({
      externalId,
      from,
      to,
      lat: coords.lat ?? undefined,
      lng: coords.lng ?? undefined
    })
    .catch(() => null);
  if (!pickups) {
    return null;
  }
  const upcoming: HaulerUpcoming = { from, to, pickups };
  await prisma.haulerScheduleLookup
    .update({
      where: { addressHash },
      data: {
        upcomingPickups: upcoming as unknown as Prisma.InputJsonValue,
        upcomingFetchedAt: now
      }
    })
    .catch(() => {
      // Best-effort cache write.
    });
  return upcoming;
}

// Best-effort: resolves the customer's trash hauler schedule for pre-filling the
// first pickup day. Never throws — returns { matched:false } when nothing is
// found or a provider is unavailable. On a fresh match it also seeds the concrete
// upcoming-pickup cache the scheduler uses for holiday shifts.
export async function lookupPickupSchedule(input: HaulerLookupInput): Promise<PickupScheduleSuggestion> {
  const addressHash = haulerAddressHash(input);

  const cached = await prisma.haulerScheduleLookup
    .findUnique({ where: { addressHash } })
    .catch(() => null);
  if (cached?.matched && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    const parsed = pickupScheduleSuggestionSchema.safeParse(cached.suggestion);
    if (parsed.success) {
      return parsed.data;
    }
  }

  const providers = PROVIDERS.filter((provider) => provider.serves(input));
  const results = await Promise.all(
    providers.map(async (provider) => ({ provider, result: await provider.lookup(input).catch(() => null) }))
  );
  const winner = results.find((entry) => entry.result?.suggestion.matched) ?? null;
  const suggestion = winner?.result?.suggestion ?? EMPTY;

  // Cache positive matches only — a miss is often a transient provider outage,
  // and we don't want to lock in a wrong "no schedule" for a week.
  if (winner?.result?.suggestion.matched) {
    const result = winner.result;
    const coords = result.coords;
    await prisma.haulerScheduleLookup
      .upsert({
        where: { addressHash },
        create: {
          addressHash,
          provider: suggestion.provider ?? "unknown",
          externalId: result.externalId ?? null,
          matched: true,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          suggestion: suggestion as unknown as Prisma.InputJsonValue
        },
        update: {
          provider: suggestion.provider ?? "unknown",
          externalId: result.externalId ?? null,
          matched: true,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          suggestion: suggestion as unknown as Prisma.InputJsonValue,
          fetchedAt: new Date()
        }
      })
      .catch(() => {
        // Cache write is best-effort; a failure must not break the lookup.
      });

    // Seed the concrete upcoming-pickup cache for the scheduler.
    if (result.externalId) {
      await fetchAndStoreUpcoming(addressHash, winner.provider, result.externalId, {
        lat: coords?.lat,
        lng: coords?.lng
      });
    }
  }

  return suggestion;
}

// Read the cached concrete upcoming pickups for an address, if present/valid.
export async function getCachedUpcoming(addressHash: string): Promise<HaulerUpcoming | null> {
  const row = await prisma.haulerScheduleLookup.findUnique({ where: { addressHash } }).catch(() => null);
  if (!row?.upcomingPickups) {
    return null;
  }
  const parsed = haulerUpcomingSchema.safeParse(row.upcomingPickups);
  return parsed.success ? parsed.data : null;
}

// Ensure we have concrete upcoming pickups covering `requiredThrough` for a
// matched address, refreshing from the hauler only when the cached window falls
// short. Returns null for unmatched addresses (scheduler then uses normal dates).
export async function getUpcomingForAddress(
  input: HaulerLookupInput,
  requiredThrough: Date,
  coords?: { lat?: number | null; lng?: number | null }
): Promise<HaulerUpcoming | null> {
  const addressHash = haulerAddressHash(input);
  const row = await prisma.haulerScheduleLookup.findUnique({ where: { addressHash } }).catch(() => null);
  if (!row?.matched || !row.externalId || !row.provider) {
    return null;
  }

  const cached = await getCachedUpcoming(addressHash);
  if (cached && new Date(`${cached.to}T00:00:00Z`).getTime() >= requiredThrough.getTime()) {
    return cached;
  }

  const provider = providerById(row.provider);
  if (!provider) {
    return cached;
  }
  const refreshed = await fetchAndStoreUpcoming(addressHash, provider, row.externalId, {
    lat: coords?.lat ?? row.lat,
    lng: coords?.lng ?? row.lng
  });
  return refreshed ?? cached;
}
