import { env } from "../lib/env";

const ORS_BASE = "https://api.openrouteservice.org";

export type GeocodeResult = { lat: number; lng: number; label: string };

// Resolve a free-text address to coordinates via OpenRouteService (Pelias).
// Returns null on any failure so callers can fall back gracefully.
export async function geocode(text: string): Promise<GeocodeResult | null> {
  if (!env.ORS_API_KEY || !text.trim()) {
    return null;
  }
  const url = `${ORS_BASE}/geocode/search?api_key=${env.ORS_API_KEY}&size=1&boundary.country=US&text=${encodeURIComponent(
    text
  )}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: { label?: string };
      }>;
    };
    const feature = payload.features?.[0];
    const coords = feature?.geometry?.coordinates;
    if (!coords) {
      return null;
    }
    return { lat: coords[1], lng: coords[0], label: feature?.properties?.label ?? text };
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
