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
        const routeJobDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 0, 0);

        const jobs = await prisma.serviceJob.findMany({
          where: { scheduledDate: routeJobDate, type: "CURB_OUT", assignedOperatorId: { not: null } },
          include: {
            serviceAddress: { include: { user: { select: { name: true } } } },
            assignedOperator: { select: { id: true, name: true } }
          },
          orderBy: { routeSequence: "asc" }
        });

        const byOperator = new Map<
          string,
          { operatorId: string; operatorName: string; stops: unknown[] }
        >();
        for (const job of jobs) {
          const op = job.assignedOperator;
          if (!op) {
            continue;
          }
          let route = byOperator.get(op.id);
          if (!route) {
            route = { operatorId: op.id, operatorName: op.name, stops: [] };
            byOperator.set(op.id, route);
          }
          route.stops.push({
            order: job.routeSequence ?? route.stops.length,
            addressId: job.serviceAddress.id,
            line1: job.serviceAddress.line1,
            city: job.serviceAddress.city,
            state: job.serviceAddress.state,
            postalCode: job.serviceAddress.postalCode,
            customerName: job.serviceAddress.user.name
          });
        }

        return jsonResponse(
          200,
          assignedRoutesResponseSchema.parse({
            date: now.toISOString(),
            routes: [...byOperator.values()]
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
        // Route-job time = end of today (local), so it stays "today" and ahead of
        // the operator queue's "from now" window through the day.
        const routeJobDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 0, 0);

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
        for (const a of addresses) {
          const pickups = a.schedules.filter(
            (sch) => sch.cadence === "WEEKLY" || biweeklyMatchesToday(sch.biweeklyAnchorDate, now)
          );
          const subscriptionId = a.subscriptions[0]?.id;
          if (pickups.length === 0 || !subscriptionId) {
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
              assigned: assigning
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

        // Persist the assignment as one route-job per stop (CURB_OUT at end of
        // today), so each operator owns their stops and sees them on their
        // dashboard. Re-running replaces the day's assignments.
        if (assigning) {
          const stopById = new Map(stops.map((stop) => [stop.addressId, stop] as const));
          await prisma.serviceJob.updateMany({
            where: { scheduledDate: routeJobDate, type: "CURB_OUT" },
            data: { assignedOperatorId: null, routeSequence: null }
          });
          for (const leg of legs) {
            if (!leg.operatorId) {
              continue;
            }
            for (const stop of leg.stops) {
              const build = stopById.get(stop.addressId);
              if (!build) {
                continue;
              }
              await prisma.serviceJob.upsert({
                where: {
                  serviceAddressId_scheduledDate_type: {
                    serviceAddressId: stop.addressId,
                    scheduledDate: routeJobDate,
                    type: "CURB_OUT"
                  }
                },
                create: {
                  serviceAddressId: stop.addressId,
                  subscriptionId: build.subscriptionId,
                  scheduledDate: routeJobDate,
                  type: "CURB_OUT",
                  status: "SCHEDULED",
                  assignedOperatorId: leg.operatorId,
                  routeSequence: stop.order
                },
                update: {
                  assignedOperatorId: leg.operatorId,
                  routeSequence: stop.order,
                  status: "SCHEDULED"
                }
              });
            }
          }
        }

        return jsonResponse(
          200,
          adminRouteResponseSchema.parse({
            date: now.toISOString(),
            start,
            end,
            routes: legs,
            assigned: assigning
          })
        );
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}
