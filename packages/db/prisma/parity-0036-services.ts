// Parity check for migration 0036 — run AFTER the backfill, READ-ONLY.
//
// Proves two things per location, using the SAME pricing code the app bills with:
//
//  1. LOSSLESS BACKFILL (must hold for every address): pricing the projection of
//     the new service model with the OLD pricing rules equals pricing the
//     original ServiceSchedule rows. Any mismatch = a backfill bug.
//
//  2. INTENDED PRICE CHANGE (informational): the NEW service pricing (flat
//     pet-waste) vs. the original. Deltas are expected ONLY for locations with
//     2+ dogs (old per-dog surcharge -> new flat $60). Everything else must match.
//
// Run:  DATABASE_URL=... DIRECT_URL=... pnpm --filter @gpp/db exec tsx prisma/parity-0036-services.ts

import { PrismaClient } from "@prisma/client";
import {
  addressMonthlyCents,
  addressServicesMonthlyCents,
  projectToLegacyDays,
  formatUsd,
  type PricingService,
  type ProjectionService,
  type ScheduleCan,
  type ServiceType
} from "@gpp/shared";

const prisma = new PrismaClient();

function parseCans(value: unknown): ScheduleCan[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c): c is ScheduleCan => !!c && typeof c === "object" && "type" in c && "count" in c
  );
}

async function main(): Promise<void> {
  const addresses = await prisma.serviceAddress.findMany({
    include: { schedules: true, locationServices: { include: { days: true } } }
  });

  const backfillBugs: string[] = [];
  const intendedChanges: string[] = [];
  let checked = 0;

  for (const addr of addresses) {
    if (addr.schedules.length === 0) continue;
    checked++;

    // Original per-day pricing from ServiceSchedule (the current source of truth).
    const originalCents = addressMonthlyCents(
      addr.schedules.map((s) => ({
        cans: parseCans(s.cans),
        rollIn: s.rollIn,
        petWasteDogs: s.petWasteDogs
      }))
    );

    // New service model, as backfilled.
    const projectionServices: ProjectionService[] = addr.locationServices.map((svc) => ({
      type: svc.type as ServiceType,
      options: (svc.options as Record<string, unknown>) ?? {},
      days: svc.days.map((d) => ({
        dayOfWeek: d.dayOfWeek,
        cadence: d.cadence,
        biweeklyAnchorDate: d.biweeklyAnchorDate ? d.biweeklyAnchorDate.toISOString() : null,
        rollIn: d.rollIn,
        providerSynced: d.providerSynced,
        cans: parseCans(d.cans)
      }))
    }));

    // (1) Lossless check: project new -> legacy, price with OLD rules.
    const projectedLegacy = projectToLegacyDays(projectionServices);
    const projectedCents = addressMonthlyCents(
      projectedLegacy.map((d) => ({ cans: d.cans, rollIn: d.rollIn, petWasteDogs: d.petWasteDogs }))
    );
    if (projectedCents !== originalCents) {
      backfillBugs.push(
        `  ${addr.id} (${addr.line1}): original ${formatUsd(originalCents)} != projected ${formatUsd(projectedCents)}`
      );
    }

    // (2) Intended pricing change: new flat model vs original.
    const pricingServices: PricingService[] = projectionServices.map((s) => ({
      type: s.type,
      days: s.days.map((d) => ({ cans: d.cans, rollIn: d.rollIn }))
    }));
    const newCents = addressServicesMonthlyCents(pricingServices);
    if (newCents !== originalCents) {
      const delta = newCents - originalCents;
      intendedChanges.push(
        `  ${addr.id} (${addr.line1}): ${formatUsd(originalCents)} -> ${formatUsd(newCents)} (${delta >= 0 ? "+" : ""}${formatUsd(delta)})`
      );
    }
  }

  console.log(`\nChecked ${checked} locations with schedules.\n`);

  console.log(`(1) Lossless-backfill mismatches (MUST be zero): ${backfillBugs.length}`);
  if (backfillBugs.length > 0) {
    console.log(backfillBugs.join("\n"));
    console.log("\n  ^^ These indicate a BACKFILL BUG — do not proceed to cutover.\n");
  }

  console.log(`\n(2) Locations whose monthly total changes under the new pricing: ${intendedChanges.length}`);
  if (intendedChanges.length > 0) {
    console.log("  (expected only for 2+ dog pet-waste; review before cutover)");
    console.log(intendedChanges.join("\n"));
  }
  console.log("");

  if (backfillBugs.length > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Parity check failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
