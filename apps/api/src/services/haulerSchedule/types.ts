import type { HaulerUpcomingPickup, PickupScheduleSuggestion } from "@gpp/shared";

// The address a customer is adding, used to look up their hauler's schedule.
export type HaulerLookupInput = {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
};

// A request for concrete, holiday-accurate collection dates over a window, keyed
// by the hauler-side id resolved during the initial lookup.
export type UpcomingPickupsRequest = {
  externalId: string;
  from: string; // YYYY-MM-DD (inclusive)
  to: string; // YYYY-MM-DD (inclusive)
  lat?: number;
  lng?: number;
};

// A provider's normalized result plus the hauler-side id we resolved (stored so
// a cached lookup can be refreshed later without re-searching the address), and
// coordinates when the provider resolved them (Republic needs them for holidays).
export type ProviderResult = {
  externalId?: string;
  coords?: { lat: number; lng: number };
  suggestion: PickupScheduleSuggestion;
};

// A single hauler integration (e.g. Cascade Disposal via ReCollect). `serves`
// is a cheap pre-filter (by state/postal) so we only call providers that could
// plausibly cover the address.
export interface HaulerProvider {
  id: string;
  label: string;
  serves(input: HaulerLookupInput): boolean;
  lookup(input: HaulerLookupInput): Promise<ProviderResult | null>;
  // Concrete, holiday-accurate collection dates over a window. Returns null on
  // any failure so the scheduler falls back to the normal weekday/cadence.
  getUpcomingPickups(req: UpcomingPickupsRequest): Promise<HaulerUpcomingPickup[] | null>;
}
