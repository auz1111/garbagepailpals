import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import {
  adminRouteRequestSchema,
  adminRouteResponseSchema,
  adminRouteSummarySchema,
  adminTodaysLocationsResponseSchema,
  assignedRoutesResponseSchema,
  availableOperatorsResponseSchema
} from "@gpp/shared";
import { env } from "../lib/env";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";

const ORS_BASE = "https://api.openrouteservice.org";
const ACTIVE_SUB_STATUSES: ("ACTIVE" | "TRIALING")[] = ["ACTIVE", "TRIALING"];

// A biweekly day is "on" for a given date when a whole even number of weeks has
// passed since its first-pickup anchor.
function biweeklyMatches(anchor: Date | null, date: Date): boolean {
  if (!anchor) {
    return false;
  }
  const days = Math.floor((date.getTime() - anchor.getTime()) / 86_400_000);
  return Math.floor(days / 7) % 2 === 0;
}

// The work for a single location on a given operating day.
type ServiceWork = {
  address: {
    id: string;
    line1: string;
    city: string;
    state: string;
    postalCode: string;
    neighborhoodId: string | null;
    neighborhood: { name: string } | null;
    user: { name: string };
    lat: { toNumber: () => number };
    lng: { toNumber: () => number };
  };
  subscriptionId: string;
  jobTypes: string[]; // "CURB_OUT" (roll cart out) and/or "CURB_IN" (roll cart in)
  canCount: number;
};

const SERVICE_ADDRESS_INCLUDE = {
  schedules: true,
  user: { select: { name: true } },
  neighborhood: { select: { name: true } },
  subscriptions: { where: { status: { in: ACTIVE_SUB_STATUSES } }, take: 1 }
} as const;

// The cart-handling work due on the operating day `now`:
//  - Roll OUT the cart the evening before pickup  → pickups scheduled TOMORROW.
//  - Roll IN the cart the day after pickup (opted-in) → pickups that were YESTERDAY.
// A location can need both on the same day (e.g. two pickups a week).
async function collectTodaysWork(now: Date, neighborhoodId?: string): Promise<ServiceWork[]> {
  const dayMs = 86_400_000;
  const rollOutDate = new Date(now.getTime() + dayMs);
  const rollInDate = new Date(now.getTime() - dayMs);
  const rollOutWeekday = rollOutDate.getDay();
  const rollInWeekday = rollInDate.getDay();

  const addresses = await prisma.serviceAddress.findMany({
    where: {
      isActive: true,
      ...(neighborhoodId ? { neighborhoodId } : {}),
      subscriptions: { some: { status: { in: ACTIVE_SUB_STATUSES } } },
      schedules: { some: { pickupDayOfWeek: { in: [rollOutWeekday, rollInWeekday] } } }
    },
    include: SERVICE_ADDRESS_INCLUDE
  });

  const work: ServiceWork[] = [];
  for (const a of addresses) {
    const subscriptionId = a.subscriptions[0]?.id;
    if (!subscriptionId) {
      continue;
    }
    const rollOutSched = a.schedules.find(
      (s) =>
        s.pickupDayOfWeek === rollOutWeekday &&
        (s.cadence === "WEEKLY" || biweeklyMatches(s.biweeklyAnchorDate, rollOutDate))
    );
    const rollInSched = a.schedules.find(
      (s) =>
        s.pickupDayOfWeek === rollInWeekday &&
        s.rollIn &&
        (s.cadence === "WEEKLY" || biweeklyMatches(s.biweeklyAnchorDate, rollInDate))
    );
    const jobTypes: string[] = [];
    if (rollOutSched) jobTypes.push("CURB_OUT");
    if (rollInSched) jobTypes.push("CURB_IN");
    if (jobTypes.length === 0) {
      continue;
    }
    // Cans for the relevant pickup day (prefer the roll-out day's schedule).
    const canCount = (rollOutSched ?? rollInSched)?.canCount ?? 0;
    work.push({ address: a as unknown as ServiceWork["address"], subscriptionId, jobTypes, canCount });
  }
  return work;
}

// Users who can run a route: operators, plus admins granted operator access.
function operatorWhere() {
  return {
    OR: [{ role: "OPERATOR" as const }, { role: "ADMIN" as const, operatorAccess: true }]
  };
}

// Today's service day as a date-only (UTC midnight) key, matching how routes
// are stored/queried by day.
export function todayServiceDate(now: Date): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
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
  stops: Array<{
    sequence: number;
    serviceAddressId: string;
    jobTypes: string;
    canCount: number;
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
        const dateParam = new URL(req.url).searchParams.get("date");
        const dateStr = dateParam ?? new Date().toISOString().slice(0, 10);
        const date = new Date(`${dateStr}T00:00:00Z`);

        const operators = await prisma.user.findMany({
          where: { ...operatorWhere(), timeOff: { none: { date, status: "APPROVED" } } },
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
      async () => {
        const now = new Date();
        const serviceDate = todayServiceDate(now);

        const routes = await prisma.dailyRoute.findMany({
          where: { serviceDate },
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

// Admin cancels an accepted/completed route (e.g. operator can't finish). The
// un-serviced stops are freed for reassignment; serviced stops stay on the
// route as a record, and the route is marked CANCELLED.
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
        // Free the stops that weren't serviced yet, then mark the route cancelled.
        await prisma.routeStop.deleteMany({ where: { routeId, servicedAt: null } });
        await prisma.dailyRoute.update({ where: { id: routeId }, data: { status: "CANCELLED" } });

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
      async (req) => {
        const neighborhoodId = new URL(req.url).searchParams.get("neighborhoodId") || undefined;
        const now = new Date();
        const serviceDate = todayServiceDate(now);

        const work = await collectTodaysWork(now, neighborhoodId);
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
      async (req) => {
        const neighborhoodId = new URL(req.url).searchParams.get("neighborhoodId") || undefined;
        const now = new Date();
        const serviceDate = todayServiceDate(now);

        const work = await collectTodaysWork(now, neighborhoodId);

        const routeStopRows = await prisma.routeStop.findMany({
          where: { route: { serviceDate } },
          select: { serviceAddressId: true, route: { select: { status: true } } }
        });
        const statusByAddress = new Map(routeStopRows.map((r) => [r.serviceAddressId, r.route.status]));

        const locations = work.map((w) => ({
          addressId: w.address.id,
          line1: w.address.line1,
          city: w.address.city,
          state: w.address.state,
          postalCode: w.address.postalCode,
          customerName: w.address.user.name,
          lat: w.address.lat.toNumber(),
          lng: w.address.lng.toNumber(),
          assigned: statusByAddress.has(w.address.id),
          routeStatus: statusByAddress.get(w.address.id) ?? null,
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
      async (req) => {
        if (!env.ORS_API_KEY) {
          throw new HttpError(400, "Routing is not configured (ORS_API_KEY missing).");
        }
        const apiKey = env.ORS_API_KEY;
        const input = await parseJson(req, adminRouteRequestSchema);
        const operatorIds = input.operatorIds ?? [];
        const assigning = operatorIds.length > 0;

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
        const work = await collectTodaysWork(now, input.neighborhoodId);
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
            canCount: w.canCount
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
                    canCount: stop.canCount
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
                    canCount: stop.canCount
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
