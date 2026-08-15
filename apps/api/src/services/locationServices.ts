// The generic service model's read/write layer, and the projection that lets the
// trash-routing / calendar / serializer code keep its day-and-cans logic while
// reading LocationService/ServiceDay (ServiceSchedule has been retired).
import { prisma } from "@gpp/db";
import { Prisma } from "@prisma/client";
import {
  SERVICE_FLAT_PRICING_CENTS,
  cansHaveGlass,
  cansToCadence,
  cansToCanCount,
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

    // Keep the legacy pickupsPerWeek convenience field in sync (distinct weekdays
    // across all services).
    const weekdays = new Set<number>();
    for (const s of normalized) for (const d of s.days) weekdays.add(d.dayOfWeek);
    await tx.serviceAddress.update({
      where: { id: addressId },
      data: { pickupsPerWeek: weekdays.size }
    });
  });

  return getLocationServices(addressId);
}

// A location's services projected to the legacy per-day schedule shape (one row
// per weekday: trash cans + pet-waste dogs merged), so trash-routing / calendar /
// serializer code keeps its proven day-and-cans logic while reading the service
// model. Dates are real (not ISO strings) so the routing reconcile works as-is.
export type ProjectedSchedule = {
  id: string;
  serviceAddressId: string;
  pickupDayOfWeek: number;
  cadence: "WEEKLY" | "BIWEEKLY";
  biweeklyAnchorDate: Date | null;
  canCount: number;
  rollIn: boolean;
  glassRecycling: boolean;
  petWasteDogs: number;
  providerSynced: boolean;
  cans: ScheduleCan[];
  createdAt: Date;
  updatedAt: Date;
};

// Minimal day shape the projection needs (no id required, so any query that
// includes ServiceDay rows can be passed in).
type ProjectionDay = {
  dayOfWeek: number;
  cadence: string;
  biweeklyAnchorDate: Date | null;
  rollIn: boolean;
  providerSynced: boolean;
  cans: unknown;
};
type ServiceForProjection = { type: string; options: unknown; days: ProjectionDay[] };

export function schedulesFromServices(
  addressId: string,
  services: ServiceForProjection[],
  ts: Date
): ProjectedSchedule[] {
  const byDay = new Map<number, ProjectedSchedule>();
  const ensure = (d: ProjectionDay): ProjectedSchedule => {
    let row = byDay.get(d.dayOfWeek);
    if (!row) {
      row = {
        id: `${addressId}:${d.dayOfWeek}`,
        serviceAddressId: addressId,
        pickupDayOfWeek: d.dayOfWeek,
        cadence: (d.cadence as "WEEKLY" | "BIWEEKLY") ?? "WEEKLY",
        biweeklyAnchorDate: d.biweeklyAnchorDate,
        canCount: 0,
        rollIn: d.rollIn,
        glassRecycling: false,
        petWasteDogs: 0,
        providerSynced: d.providerSynced,
        cans: [],
        createdAt: ts,
        updatedAt: ts
      };
      byDay.set(d.dayOfWeek, row);
    }
    return row;
  };
  // Trash defines the cans / cadence / roll-in / provider-sync for a weekday.
  for (const s of services.filter((s) => s.type === "TRASH")) {
    for (const d of s.days) {
      const cans = parseCans(d.cans);
      const row = ensure(d);
      row.cans = cans;
      row.cadence = cans.length > 0 ? cansToCadence(cans) : (d.cadence as "WEEKLY" | "BIWEEKLY");
      row.canCount = cansToCanCount(cans);
      row.glassRecycling = cansHaveGlass(cans);
      row.biweeklyAnchorDate = d.biweeklyAnchorDate;
      row.rollIn = d.rollIn;
      row.providerSynced = d.providerSynced;
    }
  }
  // Pet waste folds its dog count onto the matching weekday.
  for (const s of services.filter((s) => s.type === "PET_WASTE")) {
    const opts = s.options as { dogs?: unknown } | null;
    const dogs = typeof opts?.dogs === "number" ? opts.dogs : 0;
    for (const d of s.days) ensure(d).petWasteDogs = dogs;
  }
  return [...byDay.values()].sort((a, b) => a.pickupDayOfWeek - b.pickupDayOfWeek);
}
