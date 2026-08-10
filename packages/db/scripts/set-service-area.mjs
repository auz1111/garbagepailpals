// One-off, non-destructive maintenance script.
// Makes 97702 the ONLY available service area: upserts it active and
// removes every other ServiceArea row. Touches ONLY the ServiceArea table.
//
// Usage (from repo root):
//   node packages/db/scripts/set-service-area.mjs
// Reads DATABASE_URL from apps/api/local.settings.json if not already set.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const KEEP = "97702";

if (!process.env.DATABASE_URL) {
  const here = dirname(fileURLToPath(import.meta.url));
  const settingsPath = resolve(here, "../../../apps/api/local.settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const values = settings.Values ?? {};
  if (!values.DATABASE_URL) {
    throw new Error("DATABASE_URL not found in apps/api/local.settings.json");
  }
  process.env.DATABASE_URL = values.DATABASE_URL;
  if (values.DIRECT_URL) {
    process.env.DIRECT_URL = values.DIRECT_URL;
  }
}

const { prisma } = await import("../dist/src/index.js");

await prisma.serviceArea.upsert({
  where: { postalCode: KEEP },
  update: { isActive: true },
  create: { postalCode: KEEP, isActive: true }
});

const removed = await prisma.serviceArea.deleteMany({
  where: { postalCode: { not: KEEP } }
});

const remaining = await prisma.serviceArea.findMany({
  select: { postalCode: true, isActive: true },
  orderBy: { postalCode: "asc" }
});

console.log(JSON.stringify({ removedOthers: removed.count, remaining }, null, 2));
await prisma.$disconnect();
