import type { PickupScheduleSuggestion } from "@gpp/shared";

// The address a customer is adding, used to look up their hauler's schedule.
export type HaulerLookupInput = {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
};

// A provider's normalized result plus the hauler-side id we resolved (stored so
// a cached lookup can be refreshed later without re-searching the address).
export type ProviderResult = {
  externalId?: string;
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
}
