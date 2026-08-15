// One-shot, idempotent backfill for migration 0036: populate LocationService /
// ServiceDay from the existing ServiceSchedule rows.
//
//   TRASH:     one service per address, one ServiceDay per schedule row that has
//              cans, carrying that row's cans/rollIn/providerSynced/cadence/anchor.
//   PET_WASTE: one flat-priced ($60) service per address that has any day with
//              petWasteDogs > 0, one ServiceDay per such weekday.
//
// ServiceSchedule is NOT modified. Safe to re-run: it clears any previously
// backfilled LocationService rows for each address before recreating them.
//
// Run:  DATABASE_URL=... DIRECT_URL=... pnpm --filter @gpp/db exec tsx prisma/backfill-0036-services.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PET_WASTE_FLAT_CENTS = 6000;

type Can = { type: string; cadence: "WEEKLY" | "BIWEEKLY"; count: number };

function parseCans(value: unknown): Can[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c): c is Can => !!c && typeof c === "object" && "type" in c && "count" in c
  );
}

async function main(): Promise<void> {
  const addresses = await prisma.serviceAddress.findMany({ include: { schedules: true } });
  let addrTouched = 0;
  let trashServices = 0;
  let petServices = 0;

  for (const addr of addresses) {
    if (addr.schedules.length === 0) continue;

    await prisma.$transaction(async (tx) => {
      // Idempotency: remove anything a prior run created for this address.
      await tx.locationService.deleteMany({ where: { serviceAddressId: addr.id } });

      const trashDays = addr.schedules.filter((s) => parseCans(s.cans).length > 0);
      if (trashDays.length > 0) {
        await tx.locationService.create({
          data: {
            serviceAddressId: addr.id,
            type: "TRASH",
            options: {},
            priceCents: null,
            isActive: true,
            days: {
              create: trashDays.map((s) => ({
                dayOfWeek: s.pickupDayOfWeek,
                cadence: s.cadence,
                biweeklyAnchorDate: s.biweeklyAnchorDate,
                rollIn: s.rollIn,
                providerSynced: s.providerSynced,
                cans: parseCans(s.cans) as unknown as object
              }))
            }
          }
        });
        trashServices++;
      }

      const petDays = addr.schedules.filter((s) => s.petWasteDogs > 0);
      if (petDays.length > 0) {
        const dogs = Math.max(...petDays.map((s) => s.petWasteDogs));
        await tx.locationService.create({
          data: {
            serviceAddressId: addr.id,
            type: "PET_WASTE",
            options: { dogs },
            priceCents: PET_WASTE_FLAT_CENTS,
            isActive: true,
            days: {
              create: petDays.map((s) => ({
                dayOfWeek: s.pickupDayOfWeek,
                cadence: s.cadence,
                biweeklyAnchorDate: s.biweeklyAnchorDate,
                rollIn: false,
                providerSynced: false,
                cans: [] as unknown as object
              }))
            }
          }
        });
        petServices++;
      }

      addrTouched++;
    });
  }

  console.log(
    `Backfill complete: ${addrTouched} addresses processed, ${trashServices} TRASH services, ${petServices} PET_WASTE services created.`
  );
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
