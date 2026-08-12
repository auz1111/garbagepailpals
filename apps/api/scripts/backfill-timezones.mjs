// One-time backfill: set each ServiceAddress.timezone from its stored coordinates.
//
// Usage (from repo root):
//   node apps/api/scripts/backfill-timezones.mjs           # dry-run (read-only)
//   node apps/api/scripts/backfill-timezones.mjs --apply    # write changes
//
// DB credentials are read from apps/api/local.settings.json (same as migrations).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const settings = JSON.parse(
  readFileSync(resolve(here, "../local.settings.json"), "utf8")
).Values;
process.env.DATABASE_URL = settings.DATABASE_URL;
process.env.DIRECT_URL = settings.DIRECT_URL;

const { PrismaClient } = await import("@prisma/client");
const tzlookup = (await import("tz-lookup")).default;

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

function resolveTz(lat, lng) {
  try {
    return tzlookup(lat, lng);
  } catch {
    return null;
  }
}

const addresses = await prisma.serviceAddress.findMany({
  select: { id: true, line1: true, city: true, state: true, lat: true, lng: true, timezone: true }
});

let changed = 0;
let unresolved = 0;
const samples = [];
for (const a of addresses) {
  const tz = resolveTz(Number(a.lat), Number(a.lng));
  if (!tz) {
    unresolved += 1;
    continue;
  }
  if (tz !== a.timezone) {
    changed += 1;
    if (samples.length < 10) {
      samples.push(`  ${a.line1}, ${a.city} ${a.state}: ${a.timezone} -> ${tz}`);
    }
    if (APPLY) {
      await prisma.serviceAddress.update({ where: { id: a.id }, data: { timezone: tz } });
    }
  }
}

console.log(`Total addresses:      ${addresses.length}`);
console.log(`Would change:         ${changed}`);
console.log(`Unresolved coords:    ${unresolved}`);
if (samples.length) {
  console.log(`Sample changes:\n${samples.join("\n")}`);
}
console.log(APPLY ? "APPLIED changes." : "DRY RUN — no changes written. Re-run with --apply to write.");

await prisma.$disconnect();
