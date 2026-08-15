// Billing parity check for Phase 5 — READ ONLY.
//
// Confirms that switching billing from ServiceSchedule to the new LocationService
// model does NOT change any existing location's monthly total. For trash-only
// locations (all of prod today) the two must match to the cent; a nonzero diff
// would mean a real customer's bill moved.
//
// Run:  DATABASE_URL=... DIRECT_URL=... pnpm --filter @gpp/db exec tsx prisma/parity-0036-billing.ts

import { PrismaClient } from "@prisma/client";
import {
  addressMonthlyCents,
  formatUsd,
  locationServicesMonthlyCents,
  type ScheduleCan,
  type ServicePricing,
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
    where: { isActive: true },
    include: { schedules: true, locationServices: { include: { days: true } } }
  });

  const diffs: string[] = [];
  for (const a of addresses) {
    // Old: from ServiceSchedule (the pre-Phase-5 billing source).
    const oldCents = addressMonthlyCents(
      a.schedules.map((s) => ({
        cans: parseCans(s.cans),
        rollIn: s.rollIn,
        petWasteDogs: s.petWasteDogs
      }))
    );
    // New: from the generic service model (what billing now reads).
    const services: ServicePricing[] = a.locationServices.map((svc) => ({
      type: svc.type as ServiceType,
      days: svc.days.map((d) => ({
        dayOfWeek: d.dayOfWeek,
        cadence: d.cadence as "WEEKLY" | "BIWEEKLY",
        cans: parseCans(d.cans),
        rollIn: d.rollIn
      }))
    }));
    const newCents = locationServicesMonthlyCents(services);

    if (oldCents !== newCents) {
      diffs.push(
        `  ${a.id} (${a.line1}): old ${formatUsd(oldCents)} -> new ${formatUsd(newCents)}`
      );
    }
  }

  console.log(`\nChecked ${addresses.length} active locations.`);
  console.log(`Billing total mismatches (MUST be zero for trash-only prod data): ${diffs.length}`);
  if (diffs.length > 0) {
    console.log(diffs.join("\n"));
    console.log(
      "\n  ^^ A nonzero count means a real customer's monthly total moved — review before relying on billing.\n"
    );
    process.exitCode = 1;
  } else {
    console.log("All locations price identically under the new model. ✅\n");
  }
}

main()
  .catch((err) => {
    console.error("Billing parity check failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
