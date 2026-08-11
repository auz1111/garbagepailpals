import { env } from "../lib/env";

const GOOGLE_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

export type GeocodeResult = { lat: number; lng: number; label: string };

export function isGeocodingConfigured(): boolean {
  return Boolean(env.GOOGLE_GEOCODING_API_KEY);
}

// Resolve a free-text address to coordinates via the Google Geocoding API,
// which has full US rooftop coverage. Returns null on any failure so callers
// can fall back gracefully.
export async function geocode(text: string): Promise<GeocodeResult | null> {
  if (!env.GOOGLE_GEOCODING_API_KEY || !text.trim()) {
    return null;
  }
  const url = `${GOOGLE_GEOCODE_URL}?components=country:US&address=${encodeURIComponent(text)}&key=${env.GOOGLE_GEOCODING_API_KEY}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      status?: string;
      results?: Array<{
        formatted_address?: string;
        geometry?: { location?: { lat: number; lng: number } };
      }>;
    };
    const top = payload.status === "OK" ? payload.results?.[0] : undefined;
    const location = top?.geometry?.location;
    if (!location) {
      return null;
    }
    return { lat: location.lat, lng: location.lng, label: top?.formatted_address ?? text };
  } catch {
    return null;
  }
}

// Convenience for a structured service address.
export async function geocodeAddressParts(parts: {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
}): Promise<{ lat: number; lng: number } | null> {
  const result = await geocode(`${parts.line1}, ${parts.city}, ${parts.state} ${parts.postalCode}`);
  return result ? { lat: result.lat, lng: result.lng } : null;
}
