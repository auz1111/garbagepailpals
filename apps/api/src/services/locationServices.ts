// The generic service model's read/write layer.
//
// applyLocationServices() is the single write path: it replaces a location's
// LocationService/ServiceDay rows AND regenerates the legacy ServiceSchedule rows
// from the trash/pet-waste projection in the same transaction (dual-write), so
// every consumer still reading ServiceSchedule (billing, routing, serializers)
// stays correct for trash/pet-waste until it's migrated to read services natively.
import { prisma } from "@gpp/db";
import { Prisma } from "@prisma/client";
import {
  SERVICE_FLAT_PRICING_CENTS,
  cansHaveGlass,
  cansToCadence,
  cansToCanCount,
  projectToLegacyDays,
  serviceMonthlyCents,
  serviceOptionsSchemaFor,
  type LocationServiceView,
  type ScheduleCan,
  type ServiceType
} from "@gpp/shared";

// The parsed (input-shaped) service write payload. Defaults are applied at parse
// time by zod, but the inferred type keeps them optional — coalesce below.
type ServiceDayInputLike = {
  dayOfWeek: number;
  cadence?: "WEEKLY" | "BIWEEKLY";
  biweeklyAnchorDate?: string;
  rollIn?: boolean;
  providerSynced?: boolean;
  cans?: ScheduleCan[];
};
type ServiceInputLike = {
  type: ServiceType;
  options?: Record<string, unknown>;
  days: ServiceDayInputLike[];
};

type LocationServiceRow = {
  id: string;
  type: string;
  options: unknown;
  priceCents: number | null;
  isActive: boolean;
  days: ServiceDayRow[];
};
type ServiceDayRow = {
  id: string;
  dayOfWeek: number;
  cadence: string;
  biweeklyAnchorDate: Date | null;
  rollIn: boolean;
  providerSynced: boolean;
  cans: unknown;
};

function parseCans(value: unknown): ScheduleCan[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c): c is ScheduleCan => !!c && typeof c === "object" && "type" in c && "count" in c
  );
}

export function serializeLocationService(row: LocationServiceRow): LocationServiceView {
  const days = row.days
    .slice()
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    .map((d) => ({
      id: d.id,
      dayOfWeek: d.dayOfWeek,
      cadence: d.cadence as "WEEKLY" | "BIWEEKLY",
      biweeklyAnchorDate: d.biweeklyAnchorDate ? d.biweeklyAnchorDate.toISOString() : null,
      rollIn: d.rollIn,
      providerSynced: d.providerSynced,
      cans: parseCans(d.cans)
    }));
  const type = row.type as ServiceType;
  const monthlyCents = serviceMonthlyCents({
    type,
    days: days.map((d) => ({ cans: d.cans, rollIn: d.rollIn }))
  });
  return {
    id: row.id,
    type,
    options: (row.options as Record<string, unknown>) ?? {},
    priceCents: row.priceCents,
    isActive: row.isActive,
    monthlyCents,
    days
  };
}

export async function getLocationServices(addressId: string): Promise<LocationServiceView[]> {
  const rows = await prisma.locationService.findMany({
    where: { serviceAddressId: addressId },
    include: { days: true },
    orderBy: { createdAt: "asc" }
  });
  return rows.map(serializeLocationService);
}

// Replace all services for a location (new model) + dual-write ServiceSchedule.
export async function applyLocationServices(
  addressId: string,
  services: ServiceInputLike[]
): Promise<LocationServiceView[]> {
  // Validate + normalize options per type, apply day defaults, resolve the price.
  const normalized = services.map((s) => ({
    type: s.type,
    options: serviceOptionsSchemaFor(s.type).parse(s.options ?? {}) as Record<string, unknown>,
    priceCents: SERVICE_FLAT_PRICING_CENTS[s.type],
    days: s.days.map((d) => ({
      dayOfWeek: d.dayOfWeek,
      cadence: (d.cadence ?? "WEEKLY") as "WEEKLY" | "BIWEEKLY",
      biweeklyAnchorDate: d.biweeklyAnchorDate,
      rollIn: d.rollIn ?? true,
      providerSynced: d.providerSynced ?? false,
      cans: d.cans ?? []
    }))
  }));

  await prisma.$transaction(async (tx) => {
    await tx.locationService.deleteMany({ where: { serviceAddressId: addressId } });

    for (const s of normalized) {
      await tx.locationService.create({
        data: {
          serviceAddressId: addressId,
          type: s.type,
          options: s.options as Prisma.InputJsonValue,
          priceCents: s.priceCents,
          isActive: true,
          days: {
            create: s.days.map((d) => ({
              dayOfWeek: d.dayOfWeek,
              cadence: d.cadence,
              biweeklyAnchorDate: d.biweeklyAnchorDate ? new Date(d.biweeklyAnchorDate) : null,
              rollIn: d.rollIn,
              providerSynced: d.providerSynced,
              cans: (d.cans ?? []) as unknown as Prisma.InputJsonValue
            }))
          }
        }
      });
    }

    // Dual-write: regenerate the legacy ServiceSchedule rows from the projection.
    const legacyDays = projectToLegacyDays(
      normalized.map((s) => ({
        type: s.type,
        options: s.options,
        days: s.days.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          cadence: d.cadence,
          biweeklyAnchorDate: d.biweeklyAnchorDate ?? null,
          rollIn: d.rollIn,
          providerSynced: d.providerSynced,
          cans: d.cans ?? []
        }))
      }))
    );
    await tx.serviceSchedule.deleteMany({ where: { serviceAddressId: addressId } });
    if (legacyDays.length > 0) {
      await tx.serviceSchedule.createMany({
        data: legacyDays.map((day) => ({
          serviceAddressId: addressId,
          pickupDayOfWeek: day.dayOfWeek,
          cadence: cansToCadence(day.cans),
          biweeklyAnchorDate: day.biweeklyAnchorDate ? new Date(day.biweeklyAnchorDate) : null,
          canCount: cansToCanCount(day.cans),
          rollIn: day.rollIn,
          glassRecycling: cansHaveGlass(day.cans),
          petWasteDogs: day.petWasteDogs,
          providerSynced: day.providerSynced,
          cans: day.cans as unknown as Prisma.InputJsonValue
        }))
      });
    }

    await tx.serviceAddress.update({
      where: { id: addressId },
      data: { pickupsPerWeek: legacyDays.length }
    });
  });

  return getLocationServices(addressId);
}
