import { prisma } from "@gpp/db";
import { Prisma } from "@prisma/client";
import { pickupScheduleSuggestionSchema, type PickupScheduleSuggestion } from "@gpp/shared";
import type { HaulerLookupInput, HaulerProvider } from "./types";
import { createRecollectProvider } from "./recollect";
import { createRepublicProvider } from "./republic";

// Cached matches are reused for a week; hauler schedules change rarely and this
// keeps us off the third-party APIs on repeat loads of the same address.
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
    // Cascade serves the Bend / Deschutes County area (Central Oregon).
    serves: (input) => input.state.trim().toUpperCase() === "OR"
  }),
  createRepublicProvider({
    id: "republic",
    label: "Republic Services",
    // National hauler — probe for any US address; publicPickup returns nothing
    // for addresses Republic doesn't service.
    serves: () => true
  })
];

// Normalized, order-stable key so the same address maps to one cache row across
// users and minor whitespace/case differences.
function normalizeHash(input: HaulerLookupInput): string {
  return [input.line1, input.city, input.state, input.postalCode]
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

// Best-effort: resolves the customer's trash hauler schedule for pre-filling the
// first pickup day. Never throws — returns { matched:false } when nothing is
// found or a provider is unavailable.
export async function lookupPickupSchedule(input: HaulerLookupInput): Promise<PickupScheduleSuggestion> {
  const addressHash = normalizeHash(input);

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
  const results = await Promise.all(providers.map((provider) => provider.lookup(input).catch(() => null)));
  const hit = results.find((result) => result?.suggestion.matched) ?? null;
  const suggestion = hit?.suggestion ?? EMPTY;

  // Cache positive matches only — a miss is often a transient provider outage,
  // and we don't want to lock in a wrong "no schedule" for a week.
  if (hit?.suggestion.matched) {
    await prisma.haulerScheduleLookup
      .upsert({
        where: { addressHash },
        create: {
          addressHash,
          provider: suggestion.provider ?? "unknown",
          externalId: hit.externalId ?? null,
          matched: true,
          suggestion: suggestion as unknown as Prisma.InputJsonValue
        },
        update: {
          provider: suggestion.provider ?? "unknown",
          externalId: hit.externalId ?? null,
          matched: true,
          suggestion: suggestion as unknown as Prisma.InputJsonValue,
          fetchedAt: new Date()
        }
      })
      .catch(() => {
        // Cache write is best-effort; a failure must not break the lookup.
      });
  }

  return suggestion;
}
