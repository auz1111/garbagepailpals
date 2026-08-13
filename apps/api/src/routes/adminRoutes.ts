import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { Prisma } from "@prisma/client";
import {
  adminRouteRequestSchema,
  adminRouteResponseSchema,
  adminRouteSummarySchema,
  adminTodaysLocationsResponseSchema,
  assignedRoutesResponseSchema,
  availableOperatorsResponseSchema,
  cansToCanCount,
  routeCancelSchema,
  routeHistoryResponseSchema,
  scheduleCanSchema,
  stopServiceVerificationItemSchema,
  type ScheduleCan,
  type StopServiceVerificationItem
} from "@gpp/shared";
import { z } from "zod";
import { env } from "../lib/env";

const cansArraySchema = z.array(scheduleCanSchema);
const verificationArraySchema = z.array(stopServiceVerificationItemSchema);

// Parse a stored cans JSON blob; fall back to empty so route building/serializing
// never throws on a malformed or legacy value.
function parseCans(value: unknown): ScheduleCan[] {
  const parsed = cansArraySchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

// Parse a stored service-verification JSON blob; empty on malformed/legacy.
function parseVerification(value: unknown): StopServiceVerificationItem[] {
  const parsed = verificationArraySchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { defaultOperatingZone, serviceDateForZone } from "../lib/timezone";
import { withAuth } from "../lib/withAuth";
import { resolveZoneScope } from "../lib/zoneScope";
import { reconcileTodaysWork, type WorkScope } from "../services/todaysWork";

const ORS_BASE = "https://api.openrouteservice.org";

// The work for a single location on a given operating day.
type ServiceWork = {
  address: {
    id: string;
    line1: string;
    city: string;
    state: string;
    postalCode: string;
    timezone: string;
    neighborhoodId: string | null;
    neighborhood: { name: string } | null;
    user: { id: string; name: string };
    lat: { toNumber: () => number };
    lng: { toNumber: () => number };
  };
  subscriptionId: string;
  jobTypes: string[]; // "CURB_OUT" (roll cart out) and/or "CURB_IN" (roll cart in)
  canCount: number;
  cans: ScheduleCan[];
  petWasteDogs: number;
};

// The cart-handling work due on the operating day `now`:
//  - Roll OUT the cart the evening before pickup  → pickups scheduled TOMORROW.
//  - Roll IN the cart the same day as pickup, after collection (opted-in)
//    → pickups scheduled TODAY.
// A location can need both on the same day (e.g. two pickups a week).
//
// Provider-synced pickup days are reconciled against the trash provider's actual
// (holiday-accurate) dates by reconcileTodaysWork, so a shifted/cancelled pickup
// doesn't land on a route. "Tomorrow"/"yesterday" resolve in EACH location's own
// timezone, so a UTC-hosted server never rolls the operating day over wrong.
async function collectTodaysWork(now: Date, scope: WorkScope = {}): Promise<ServiceWork[]> {
  const reconciled = await reconcileTodaysWork(now, scope);
  const work: ServiceWork[] = [];
  for (const r of reconciled) {
    const jobTypes: string[] = [];
    if (r.rollOut.due) jobTypes.push("CURB_OUT");
    if (r.rollIn.due) jobTypes.push("CURB_IN");
    if (jobTypes.length === 0) {
      continue;
    }
    // The cans actually collected on this day (day-accurate: weekly always,
    // biweekly only on its on-week), from the roll-out day's schedule if that's
    // what's due, else the roll-in day's.
    const chosenSched = r.rollOut.due ? r.rollOut.schedule : r.rollIn.schedule;
    const cans = r.rollOut.due ? r.rollOut.cans : r.rollIn.cans;
    work.push({
      address: r.address as unknown as ServiceWork["address"],
      subscriptionId: r.subscriptionId,
      jobTypes,
      canCount: cansToCanCount(cans),
      cans,
      petWasteDogs: chosenSched?.petWasteDogs ?? 0
    });
  }
  return work;
}

// Users who can run a route: operators, pro operators (scoped sub-admins who
// also operate), plus super/legacy admins granted operator access.
function operatorWhere() {
  return {
    OR: [
      { role: "OPERATOR" as const },
      { role: "PRO_OPERATOR" as const },
      { role: "ADMIN" as const, operatorAccess: true },
      { role: "SUPER_ADMIN" as const, operatorAccess: true }
    ]
  };
}

// Today's service day as a date-only (UTC midnight) key, matching how routes
// are stored/queried by day. Anchored to the business operating zone (not the
// server clock) so "today" is stable across environments and hosts.
export function todayServiceDate(now: Date): Date {
  return serviceDateForZone(now, defaultOperatingZone());
}

// Prisma include shape shared by every query that serializes a DailyRoute.
export const DAILY_ROUTE_INCLUDE = {
  operator: { select: { name: true } },
  stops: {
    orderBy: { sequence: "asc" as const },
    include: { serviceAddress: { include: { user: { select: { name: true } } } } }
  }
} as const;

export type DailyRouteRow = {
  id: string;
  operatorId: string;
  operator: { name: string };
  serviceDate: Date;
  status: "ASSIGNED" | "ACCEPTED" | "COMPLETED" | "CANCELLED";
  label: string | null;
  startLabel: string | null;
  startLat: number | null;
  startLng: number | null;
  endLabel: string | null;
  endLat: number | null;
  endLng: number | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  geometry: string | null;
  acceptedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  stops: Array<{
    sequence: number;
    serviceAddressId: string;
    jobTypes: string;
    canCount: number;
    cans: unknown;
    petWasteDogs: number;
    serviceVerification: unknown;
    servicedAt: Date | null;
    serviceAddress: {
      line1: string;
      city: string;
      state: string;
      postalCode: string;
      lat: { toNumber: () => number };
      lng: { toNumber: () => number };
      user: { name: string };
    };
  }>;
};

export function serializeDailyRoute(route: DailyRouteRow) {
  return {
    id: route.id,
    operatorId: route.operatorId,
    operatorName: route.operator.name,
    serviceDate: route.serviceDate.toISOString(),
    status: route.status,
    label: route.label,
    start:
      route.startLat != null && route.startLng != null
        ? { label: route.startLabel ?? "Start", lat: route.startLat, lng: route.startLng }
        : null,
    end:
      route.endLat != null && route.endLng != null
        ? { label: route.endLabel ?? "End", lat: route.endLat, lng: route.endLng }
        : null,
    totalDistanceMeters: route.distanceMeters ?? 0,
    totalDurationSeconds: route.durationSeconds ?? 0,
    geometry: route.geometry,
    acceptedAt: route.acceptedAt ? route.acceptedAt.toISOString() : null,
    cancelledAt: route.cancelledAt ? route.cancelledAt.toISOString() : null,
    cancelReason: route.cancelReason,
    stops: route.stops.map((s) => ({
      order: s.sequence,
      addressId: s.serviceAddressId,
      customerName: s.serviceAddress.user.name,
      line1: s.serviceAddress.line1,
      city: s.serviceAddress.city,
      state: s.serviceAddress.state,
      postalCode: s.serviceAddress.postalCode,
      lat: s.serviceAddress.lat.toNumber(),
      lng: s.serviceAddress.lng.toNumber(),
      jobTypes: s.jobTypes.split(",").filter(Boolean),
      canCount: s.canCount,
      cans: parseCans(s.cans),
      petWasteDogs: s.petWasteDogs,
      serviceVerification: parseVerification(s.serviceVerification),
      servicedAt: s.servicedAt ? s.servicedAt.toISOString() : null
    }))
  };
}

// Operators available on a given date. Operators are available by default; they
// are only excluded when they have an APPROVED day off on that date.
export async function adminAvailableOperatorsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req) => {
        const url = new URL(req.url);
        const dateParam = url.searchParams.get("date");
        const zoneId = url.searchParams.get("zoneId") || undefined;
        // Default "today" in the business operating zone, not UTC.
        const dateStr =
          dateParam ?? serviceDateForZone(new Date(), defaultOperatingZone()).toISOString().slice(0, 10);
        const date = new Date(`${dateStr}T00:00:00Z`);

        // When a zone is chosen, only operators who explicitly serve it are
        // available — EXCEPT full admins (super/legacy), who administer all
        // zones and are therefore available in every one. An operator who serves
        // no zones is offered no routes.
        const allZoneAdminRoles: ("SUPER_ADMIN" | "ADMIN")[] = ["SUPER_ADMIN", "ADMIN"];
        const zoneFilter = zoneId
          ? {
              OR: [
                { zones: { some: { zoneId, serves: true } } },
                { role: { in: allZoneAdminRoles } }
              ]
            }
          : {};

        const operators = await prisma.user.findMany({
          where: {
            AND: [{ ...operatorWhere() }, zoneFilter],
            timeOff: { none: { date, status: "APPROVED" } }
          },
          select: { id: true, name: true, email: true },
          orderBy: { name: "asc" }
        });

        return jsonResponse(
          200,
          availableOperatorsResponseSchema.parse({ date: dateStr, operators })
        );
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// Today's assigned routes, reconstructed from the persisted route-jobs.
export async function adminAssignedRoutesHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const zoneId = new URL(req.url).searchParams.get("zoneId") || undefined;
        const zoneIds = await resolveZoneScope(auth, zoneId);
        const now = new Date();
        const serviceDate = todayServiceDate(now);

        const routes = await prisma.dailyRoute.findMany({
          where: { serviceDate, ...(zoneIds ? { zoneId: { in: zoneIds } } : {}) },
          include: DAILY_ROUTE_INCLUDE,
          orderBy: [{ operator: { name: "asc" } }, { createdAt: "asc" }]
        });

        return jsonResponse(
          200,
          assignedRoutesResponseSchema.parse({
            date: now.toISOString(),
            routes: routes.map((r) => serializeDailyRoute(r as unknown as DailyRouteRow))
          })
        );
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// Admin removes an un-accepted route for the day, freeing its locations to be
// assigned to another operator. Accepted (locked) routes can't be removed.
export async function adminDeleteRouteHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req) => {
        const routeId = req.params.routeId;
        if (!routeId) {
          throw new HttpError(400, "routeId is required");
        }
        const route = await prisma.dailyRoute.findUnique({ where: { id: routeId } });
        if (!route) {
          throw new HttpError(404, "Route not found");
        }
        if (route.status === "ACCEPTED") {
          throw new HttpError(409, "This route has been accepted by the operator and is locked.");
        }
        await prisma.dailyRoute.delete({ where: { id: routeId } });

        const now = new Date();
        const routes = await prisma.dailyRoute.findMany({
          where: { serviceDate: todayServiceDate(now) },
          include: DAILY_ROUTE_INCLUDE,
          orderBy: [{ operator: { name: "asc" } }, { createdAt: "asc" }]
        });
        return jsonResponse(
          200,
          assignedRoutesResponseSchema.parse({
            date: now.toISOString(),
            routes: routes.map((r) => serializeDailyRoute(r as unknown as DailyRouteRow))
          })
        );
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// Admin cancels a route (accepted, completed, or not-yet-accepted). The
// un-serviced stops are freed for reassignment; serviced stops stay on the
// route as a record, and the route is marked CANCELLED with an optional reason
// kept for the audit trail.
export async function adminCancelRouteHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req) => {
        const routeId = req.params.routeId;
        if (!routeId) {
          throw new HttpError(400, "routeId is required");
        }
        const route = await prisma.dailyRoute.findUnique({ where: { id: routeId } });
        if (!route) {
          throw new HttpError(404, "Route not found");
        }
        if (route.status === "CANCELLED") {
          throw new HttpError(409, "This route is already cancelled.");
        }
        if (route.status === "COMPLETED") {
          throw new HttpError(409, "A completed route can't be cancelled.");
        }
        const { reason } = await parseJson(req, routeCancelSchema);
        // Free the stops that weren't serviced yet, then mark the route cancelled.
        await prisma.routeStop.deleteMany({ where: { routeId, servicedAt: null } });
        await prisma.dailyRoute.update({
          where: { id: routeId },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelReason: reason && reason.length > 0 ? reason : null
          }
        });

        const now = new Date();
        const routes = await prisma.dailyRoute.findMany({
          where: { serviceDate: todayServiceDate(now) },
          include: DAILY_ROUTE_INCLUDE,
          orderBy: [{ operator: { name: "asc" } }, { createdAt: "asc" }]
        });
        return jsonResponse(
          200,
          assignedRoutesResponseSchema.parse({
            date: now.toISOString(),
            routes: routes.map((r) => serializeDailyRoute(r as unknown as DailyRouteRow))
          })
        );
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// Historical routes across a rolling window (default 30 days), with aggregate
// summary stats for the admin route-history dashboard. Includes every status so
// admins can review completed, cancelled, and in-flight routes.
export async function adminRouteHistoryHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const url = new URL(req.url);
        const daysParam = Number(url.searchParams.get("days"));
        const rangeDays = Number.isFinite(daysParam)
          ? Math.min(Math.max(Math.trunc(daysParam), 1), 365)
          : 30;
        const zoneId = url.searchParams.get("zoneId") || undefined;
        const zoneIds = await resolveZoneScope(auth, zoneId);

        const now = new Date();
        const from = new Date(todayServiceDate(now));
        from.setUTCDate(from.getUTCDate() - (rangeDays - 1));

        const rows = await prisma.dailyRoute.findMany({
          where: { serviceDate: { gte: from }, ...(zoneIds ? { zoneId: { in: zoneIds } } : {}) },
          include: DAILY_ROUTE_INCLUDE,
          orderBy: [{ serviceDate: "desc" }, { operator: { name: "asc" } }, { createdAt: "asc" }]
        });
        const routes = rows.map((r) => serializeDailyRoute(r as unknown as DailyRouteRow));

        let completed = 0;
        let cancelled = 0;
        let inProgress = 0;
        let awaiting = 0;
        let stopsServiced = 0;
        let stopsTotal = 0;
        const dayMap = new Map<
          string,
          { routes: number; stopsServiced: number; stopsTotal: number }
        >();
        const opMap = new Map<
          string,
          {
            operatorId: string;
            operatorName: string;
            routes: number;
            stopsServiced: number;
            stopsTotal: number;
          }
        >();

        for (const r of routes) {
          if (r.status === "COMPLETED") completed += 1;
          else if (r.status === "CANCELLED") cancelled += 1;
          else if (r.status === "ACCEPTED") inProgress += 1;
          else awaiting += 1;

          const svc = r.stops.filter((s) => s.servicedAt).length;
          const tot = r.stops.length;
          stopsServiced += svc;
          stopsTotal += tot;

          const dayKey = r.serviceDate.slice(0, 10);
          const day = dayMap.get(dayKey) ?? { routes: 0, stopsServiced: 0, stopsTotal: 0 };
          day.routes += 1;
          day.stopsServiced += svc;
          day.stopsTotal += tot;
          dayMap.set(dayKey, day);

          const op = opMap.get(r.operatorId) ?? {
            operatorId: r.operatorId,
            operatorName: r.operatorName,
            routes: 0,
            stopsServiced: 0,
            stopsTotal: 0
          };
          op.routes += 1;
          op.stopsServiced += svc;
          op.stopsTotal += tot;
          opMap.set(r.operatorId, op);
        }

        const byDay = [...dayMap.entries()]
          .map(([date, v]) => ({ date, ...v }))
          .sort((a, b) => (a.date < b.date ? -1 : 1));
        const byOperator = [...opMap.values()].sort((a, b) => b.stopsServiced - a.stopsServiced);

        return jsonResponse(
          200,
          routeHistoryResponseSchema.parse({
            generatedAt: now.toISOString(),
            rangeDays,
            summary: {
              totalRoutes: routes.length,
              completed,
              cancelled,
              inProgress,
              awaiting,
              stopsServiced,
              stopsTotal,
              byDay,
              byOperator
            },
            routes
          })
        );
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// Cheap counts (no ORS) for the selected scope so the UI knows, before the
// admin clicks Assign, whether anything is left to assign today.
export async function adminRouteSummaryHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const url = new URL(req.url);
        const neighborhoodId = url.searchParams.get("neighborhoodId") || undefined;
        const zoneId = url.searchParams.get("zoneId") || undefined;
        const zoneIds = await resolveZoneScope(auth, zoneId);
        const now = new Date();
        const serviceDate = todayServiceDate(now);

        const work = await collectTodaysWork(now, { neighborhoodId, zoneIds });
        const routedAddressIds = new Set(
          (
            await prisma.routeStop.findMany({
              where: { route: { serviceDate } },
              select: { serviceAddressId: true }
            })
          ).map((r) => r.serviceAddressId)
        );

        const scheduledToday = work.length;
        const alreadyRouted = work.filter((w) => routedAddressIds.has(w.address.id)).length;

        return jsonResponse(
          200,
          adminRouteSummarySchema.parse({
            date: now.toISOString(),
            neighborhoodId: neighborhoodId ?? null,
            scheduledToday,
            alreadyRouted,
            unassigned: scheduledToday - alreadyRouted
          })
        );
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// All serviceable locations with a pickup scheduled today (with coordinates),
// for the map on the routes page. Optionally scoped to a neighborhood.
export async function adminTodaysLocationsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const url = new URL(req.url);
        const neighborhoodId = url.searchParams.get("neighborhoodId") || undefined;
        const zoneId = url.searchParams.get("zoneId") || undefined;
        const zoneIds = await resolveZoneScope(auth, zoneId);
        const now = new Date();
        const serviceDate = todayServiceDate(now);

        const work = await collectTodaysWork(now, { neighborhoodId, zoneIds });

        const routeStopRows = await prisma.routeStop.findMany({
          where: { route: { serviceDate } },
          select: { serviceAddressId: true, servicedAt: true, route: { select: { status: true } } }
        });
        const statusByAddress = new Map(routeStopRows.map((r) => [r.serviceAddressId, r.route.status]));
        const servicedByAddress = new Map(
          routeStopRows.map((r) => [r.serviceAddressId, r.servicedAt])
        );

        const locations = work.map((w) => ({
          addressId: w.address.id,
          line1: w.address.line1,
          city: w.address.city,
          state: w.address.state,
          postalCode: w.address.postalCode,
          customerName: w.address.user.name,
          userId: w.address.user.id,
          lat: w.address.lat.toNumber(),
          lng: w.address.lng.toNumber(),
          assigned: statusByAddress.has(w.address.id),
          routeStatus: statusByAddress.get(w.address.id) ?? null,
          servicedAt: servicedByAddress.get(w.address.id)?.toISOString() ?? null,
          jobTypes: [...w.jobTypes].sort(),
          canCount: w.canCount,
          neighborhoodId: w.address.neighborhoodId,
          neighborhoodName: w.address.neighborhood?.name ?? null
        }));

        return jsonResponse(
          200,
          adminTodaysLocationsResponseSchema.parse({ date: now.toISOString(), locations })
        );
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

type StopBuild = {
  addressId: string;
  customerName: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  lat: number;
  lng: number;
  subscriptionId: string;
  jobTypes: string[];
  canCount: number;
  cans: ScheduleCan[];
  petWasteDogs: number;
};

export async function adminTodaysRouteHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        if (!env.ORS_API_KEY) {
          throw new HttpError(400, "Routing is not configured (ORS_API_KEY missing).");
        }
        const apiKey = env.ORS_API_KEY;
        const input = await parseJson(req, adminRouteRequestSchema);
        const operatorIds = input.operatorIds ?? [];
        const assigning = operatorIds.length > 0;
        const zoneIds = await resolveZoneScope(auth, input.zoneId);

        const now = new Date();
        const serviceDate = todayServiceDate(now);

        // Locations already on a route today (any operator, assigned or accepted)
        // are spoken for — one operator per location — so exclude them.
        const routedAddressIds = new Set(
          (
            await prisma.routeStop.findMany({
              where: { route: { serviceDate } },
              select: { serviceAddressId: true }
            })
          ).map((r) => r.serviceAddressId)
        );

        // Today's work = roll-outs for tomorrow's pickups + roll-ins from
        // yesterday's pickups, optionally scoped to a neighborhood.
        const work = await collectTodaysWork(now, {
          neighborhoodId: input.neighborhoodId,
          zoneIds
        });
        const scheduledTodayCount = work.length;

        const stops: StopBuild[] = work
          .filter((w) => !routedAddressIds.has(w.address.id))
          .map((w) => ({
            addressId: w.address.id,
            customerName: w.address.user.name,
            line1: w.address.line1,
            city: w.address.city,
            state: w.address.state,
            postalCode: w.address.postalCode,
            lat: w.address.lat.toNumber(),
            lng: w.address.lng.toNumber(),
            subscriptionId: w.subscriptionId,
            jobTypes: w.jobTypes,
            canCount: w.canCount,
            cans: w.cans,
            petWasteDogs: w.petWasteDogs
          }));

        // Resolve operator names for labelling assigned legs.
        const operatorUsers = assigning
          ? await prisma.user.findMany({
              where: { id: { in: operatorIds } },
              select: { id: true, name: true }
            })
          : [];
        const operatorNameById = new Map(operatorUsers.map((u) => [u.id, u.name] as const));

        if (stops.length === 0) {
          return jsonResponse(
            200,
            adminRouteResponseSchema.parse({
              date: now.toISOString(),
              start: null,
              end: null,
              routes: [],
              assigned: assigning,
              emptyReason: scheduledTodayCount === 0 ? "none_scheduled" : "all_assigned"
            })
          );
        }

        // Routes always start from the stop nearest the cluster centroid (the
        // natural first stop) and leave the end open, so the optimizer orders the
        // remaining stops for the shortest path. ORS requires a start per vehicle.
        const cx = stops.reduce((sum, s) => sum + s.lng, 0) / stops.length;
        const cy = stops.reduce((sum, s) => sum + s.lat, 0) / stops.length;
        const anchor = stops.reduce((best, s) =>
          (s.lng - cx) ** 2 + (s.lat - cy) ** 2 < (best.lng - cx) ** 2 + (best.lat - cy) ** 2 ? s : best
        );
        const start = { label: `First stop — ${anchor.line1}`, lat: anchor.lat, lng: anchor.lng };

        // One vehicle per operator (or a single preview vehicle). Capacity splits
        // the stops into roughly equal portions across operators, each optimized.
        const vehicleCount = assigning ? operatorIds.length : 1;
        const perVehicleCap = Math.ceil(stops.length / vehicleCount);
        const vehicles = Array.from({ length: vehicleCount }, (_, i) => ({
          id: i,
          profile: "driving-car",
          capacity: [perVehicleCap],
          start: [start.lng, start.lat]
        }));

        const optimizeRes = await fetch(`${ORS_BASE}/optimization`, {
          method: "POST",
          headers: { Authorization: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            jobs: stops.map((stop, index) => ({
              id: index,
              location: [stop.lng, stop.lat],
              amount: [1]
            })),
            vehicles,
            options: { g: true }
          })
        });
        if (!optimizeRes.ok) {
          const detail = await optimizeRes.text().catch(() => "");
          throw new HttpError(502, `Route optimization failed (${optimizeRes.status}): ${detail.slice(0, 200)}`);
        }
        const optimized = (await optimizeRes.json()) as {
          routes?: Array<{
            vehicle?: number;
            distance?: number;
            duration?: number;
            geometry?: string;
            steps?: Array<{ type?: string; job?: number }>;
          }>;
        };

        const legs = (optimized.routes ?? []).map((route) => {
          const operatorId = assigning ? operatorIds[route.vehicle ?? 0] ?? null : null;
          const orderedStops = (route.steps ?? [])
            .filter((step) => step.type === "job" && typeof step.job === "number")
            .map((step, orderIndex) => {
              const stop = stops[step.job as number];
              return stop
                ? {
                    order: orderIndex,
                    addressId: stop.addressId,
                    customerName: stop.customerName,
                    line1: stop.line1,
                    city: stop.city,
                    state: stop.state,
                    postalCode: stop.postalCode,
                    lat: stop.lat,
                    lng: stop.lng,
                    jobTypes: [...stop.jobTypes].sort(),
                    canCount: stop.canCount,
                    cans: stop.cans,
                    petWasteDogs: stop.petWasteDogs
                  }
                : null;
            })
            .filter((s): s is NonNullable<typeof s> => s !== null);
          return {
            operatorId,
            operatorName: operatorId ? operatorNameById.get(operatorId) ?? null : null,
            stops: orderedStops,
            totalDistanceMeters: route.distance ?? 0,
            totalDurationSeconds: route.duration ?? 0,
            geometry: route.geometry ?? null
          };
        });

        // Persist each operator's leg as a new DailyRoute (accumulating — prior
        // routes, especially accepted ones, are never disturbed). Because we
        // excluded already-routed locations above, no location lands on two
        // routes. The operator accepts a route to lock it.
        if (assigning) {
          const neighborhood = input.neighborhoodId
            ? await prisma.neighborhood.findUnique({
                where: { id: input.neighborhoodId },
                select: { name: true }
              })
            : null;
          for (const leg of legs) {
            if (!leg.operatorId || leg.stops.length === 0) {
              continue;
            }
            await prisma.dailyRoute.create({
              data: {
                serviceDate,
                operatorId: leg.operatorId,
                status: "ASSIGNED",
                label: neighborhood?.name ?? null,
                neighborhoodId: input.neighborhoodId ?? null,
                zoneId: input.zoneId ?? null,
                startLabel: start.label,
                startLat: start.lat,
                startLng: start.lng,
                endLabel: null,
                endLat: null,
                endLng: null,
                distanceMeters: Math.round(leg.totalDistanceMeters),
                durationSeconds: Math.round(leg.totalDurationSeconds),
                geometry: leg.geometry,
                stops: {
                  create: leg.stops.map((stop) => ({
                    serviceAddressId: stop.addressId,
                    sequence: stop.order,
                    jobTypes: [...stop.jobTypes].sort().join(","),
                    canCount: stop.canCount,
                    cans: stop.cans as unknown as Prisma.InputJsonValue,
                    petWasteDogs: stop.petWasteDogs
                  }))
                }
              }
            });
          }
        }

        return jsonResponse(
          200,
          adminRouteResponseSchema.parse({
            date: now.toISOString(),
            start,
            end: null,
            routes: legs,
            assigned: assigning,
            emptyReason: null
          })
        );
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}
