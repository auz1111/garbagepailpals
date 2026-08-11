import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import {
  adminRouteRequestSchema,
  adminRouteResponseSchema,
  assignedRoutesResponseSchema,
  availableOperatorsResponseSchema
} from "@gpp/shared";
import { env } from "../lib/env";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";
import { geocode, isGeocodingConfigured } from "../services/geocoding";

const ORS_BASE = "https://api.openrouteservice.org";
const ACTIVE_SUB_STATUSES: ("ACTIVE" | "TRIALING")[] = ["ACTIVE", "TRIALING"];

// A biweekly day is "on" when a whole even number of weeks has passed since its
// first-pickup anchor.
function biweeklyMatchesToday(anchor: Date | null, now: Date): boolean {
  if (!anchor) {
    return false;
  }
  const days = Math.floor((now.getTime() - anchor.getTime()) / 86_400_000);
  return Math.floor(days / 7) % 2 === 0;
}

async function geocodeOrThrow(text: string): Promise<{ label: string; lat: number; lng: number }> {
  const result = await geocode(text);
  if (!result) {
    throw new HttpError(400, `Could not find a location for "${text}".`);
  }
  return result;
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
  status: "ASSIGNED" | "ACCEPTED";
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
      jobTypes: s.jobTypes.split(",").filter(Boolean)
    }))
  };
}

// Operators marked available on a given date.
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
          where: { ...operatorWhere(), availability: { some: { date } } },
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
        const wantsStart = Boolean(input.start && input.start.trim());
        const wantsEnd = Boolean(input.end && input.end.trim());
        if ((wantsStart || wantsEnd) && !isGeocodingConfigured()) {
          throw new HttpError(400, "Geocoding is not configured (GOOGLE_GEOCODING_API_KEY missing).");
        }

        const now = new Date();
        const weekday = now.getDay();
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

        // Today's pickups come from schedules (pickup day == today), not from the
        // offset curb-out/curb-in job times — so "today" means today's collections.
        // Optionally scoped to a single neighborhood.
        const addresses = await prisma.serviceAddress.findMany({
          where: {
            isActive: true,
            ...(input.neighborhoodId ? { neighborhoodId: input.neighborhoodId } : {}),
            subscriptions: { some: { status: { in: ACTIVE_SUB_STATUSES } } },
            schedules: { some: { pickupDayOfWeek: weekday } }
          },
          include: {
            schedules: { where: { pickupDayOfWeek: weekday } },
            user: { select: { name: true } },
            subscriptions: { where: { status: { in: ACTIVE_SUB_STATUSES } }, take: 1 }
          }
        });

        const stops: StopBuild[] = [];
        // Count addresses that actually have a pickup today (biweekly-aware, with
        // an active sub) regardless of whether they're already routed, so we can
        // distinguish "nothing scheduled" from "all already assigned".
        let scheduledTodayCount = 0;
        for (const a of addresses) {
          const pickups = a.schedules.filter(
            (sch) => sch.cadence === "WEEKLY" || biweeklyMatchesToday(sch.biweeklyAnchorDate, now)
          );
          const subscriptionId = a.subscriptions[0]?.id;
          if (pickups.length === 0 || !subscriptionId) {
            continue;
          }
          scheduledTodayCount += 1;
          if (routedAddressIds.has(a.id)) {
            continue;
          }
          const jobTypes = pickups.some((p) => p.rollIn) ? ["CURB_IN", "CURB_OUT"] : ["CURB_OUT"];
          stops.push({
            addressId: a.id,
            customerName: a.user.name,
            line1: a.line1,
            city: a.city,
            state: a.state,
            postalCode: a.postalCode,
            lat: a.lat.toNumber(),
            lng: a.lng.toNumber(),
            subscriptionId,
            jobTypes
          });
        }

        const geoStart = wantsStart ? await geocodeOrThrow((input.start as string).trim()) : null;
        const geoEnd = wantsEnd ? await geocodeOrThrow((input.end as string).trim()) : null;

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
              start: geoStart,
              end: geoEnd,
              routes: [],
              assigned: assigning,
              emptyReason: scheduledTodayCount === 0 ? "none_scheduled" : "all_assigned"
            })
          );
        }

        // ORS requires a start (or end) per vehicle, so when the admin leaves
        // start blank we anchor to the stop nearest the cluster's centroid and
        // leave the end open — the optimizer then picks the best last stop.
        const cx = stops.reduce((sum, s) => sum + s.lng, 0) / stops.length;
        const cy = stops.reduce((sum, s) => sum + s.lat, 0) / stops.length;
        const anchor = stops.reduce((best, s) =>
          (s.lng - cx) ** 2 + (s.lat - cy) ** 2 < (best.lng - cx) ** 2 + (best.lat - cy) ** 2 ? s : best
        );
        const start = geoStart ?? {
          label: `Auto — near ${anchor.line1}`,
          lat: anchor.lat,
          lng: anchor.lng
        };
        // End: explicit if given; else round-trip to an explicit start; else open.
        const end = geoEnd ?? (geoStart ? geoStart : null);

        // One vehicle per operator (or a single preview vehicle). Capacity splits
        // the stops into roughly equal portions across operators, each optimized.
        const vehicleCount = assigning ? operatorIds.length : 1;
        const perVehicleCap = Math.ceil(stops.length / vehicleCount);
        const vehicles = Array.from({ length: vehicleCount }, (_, i) => ({
          id: i,
          profile: "driving-car",
          capacity: [perVehicleCap],
          start: [start.lng, start.lat],
          ...(end ? { end: [end.lng, end.lat] } : {})
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
                    jobTypes: [...stop.jobTypes].sort()
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
                endLabel: end?.label ?? null,
                endLat: end?.lat ?? null,
                endLng: end?.lng ?? null,
                distanceMeters: Math.round(leg.totalDistanceMeters),
                durationSeconds: Math.round(leg.totalDurationSeconds),
                geometry: leg.geometry,
                stops: {
                  create: leg.stops.map((stop) => ({
                    serviceAddressId: stop.addressId,
                    sequence: stop.order,
                    jobTypes: [...stop.jobTypes].sort().join(",")
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
            end,
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
