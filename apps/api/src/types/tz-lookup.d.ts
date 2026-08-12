declare module "tz-lookup" {
  // Resolve an IANA timezone name from coordinates. Throws on out-of-range input.
  export default function tzlookup(lat: number, lon: number): string;
}
