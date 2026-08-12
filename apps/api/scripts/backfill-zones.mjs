// Phase 1 backfill for zones + roles.
//
//   node apps/api/scripts/backfill-zones.mjs             # dry-run report
//   node apps/api/scripts/backfill-zones.mjs --apply      # create zones, link neighborhoods
//   node apps/api/scripts/backfill-zones.mjs --apply --roles
//        # ALSO flip auz@ -> SUPER_ADMIN and other ADMINs -> PRO_OPERATOR
//        # (run --roles ONLY after the new code is deployed, since local shares
//         the prod DB and old prod code doesn't understand the new roles).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(readFileSync(resolve(here, "../local.settings.json"), "utf8")).Values;
process.env.DATABASE_URL = V.DATABASE_URL;
process.env.DIRECT_URL = V.DIRECT_URL;

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const ROLES = process.argv.includes("--roles");
const SUPER_ADMIN_EMAIL = "auz@garbagepailpals.com";

const neighborhoods = await prisma.neighborhood.findMany({
  select: { id: true, name: true, city: true, state: true, zoneId: true }
});

// One zone per distinct (city, state).
const zoneName = (city, state) => (state ? `${city}, ${state}` : city);
const wanted = new Map();
for (const n of neighborhoods) {
  if (!n.city) continue;
  wanted.set(zoneName(n.city, n.state), { city: n.city, state: n.state ?? null });
}

console.log(`Neighborhoods: ${neighborhoods.length}`);
console.log(`Zones to ensure: ${[...wanted.keys()].join(", ") || "(none)"}`);
const orphans = neighborhoods.filter((n) => !n.city);
if (orphans.length) console.log(`No city (left unzoned): ${orphans.map((n) => n.name).join(", ")}`);

if (APPLY) {
  const zoneIdByName = new Map();
  for (const [name, meta] of wanted) {
    const zone = await prisma.zone.upsert({
      where: { name },
      update: { city: meta.city, state: meta.state },
      create: { name, city: meta.city, state: meta.state }
    });
    zoneIdByName.set(name, zone.id);
  }
  let linked = 0;
  for (const n of neighborhoods) {
    if (!n.city) continue;
    const zid = zoneIdByName.get(zoneName(n.city, n.state));
    if (zid && n.zoneId !== zid) {
      await prisma.neighborhood.update({ where: { id: n.id }, data: { zoneId: zid } });
      linked += 1;
    }
  }
  console.log(`Zones upserted: ${zoneIdByName.size} | neighborhoods linked: ${linked}`);

  if (ROLES) {
    const superRes = await prisma.user.updateMany({
      where: { email: SUPER_ADMIN_EMAIL },
      data: { role: "SUPER_ADMIN" }
    });
    const proRes = await prisma.user.updateMany({
      where: { role: "ADMIN", email: { not: SUPER_ADMIN_EMAIL } },
      data: { role: "PRO_OPERATOR" }
    });
    console.log(`Roles: ${SUPER_ADMIN_EMAIL} -> SUPER_ADMIN (${superRes.count}); other ADMIN -> PRO_OPERATOR (${proRes.count})`);
  } else {
    console.log("Roles: skipped (pass --roles after deploy to flip them).");
  }
} else {
  console.log("DRY RUN — pass --apply to create zones/link neighborhoods.");
}

await prisma.$disconnect();
