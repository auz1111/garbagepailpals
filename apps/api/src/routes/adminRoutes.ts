import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { adminRouteRequestSchema, adminRouteResponseSchema } from "@gpp/shared";
import { env } from "../lib/env";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";
import { geocode } from "../services/geocoding";

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

        const now = new Date();
        const weekday = now.getDay(); // 0 = Sunday … 6 = Saturday

        // Locations with an active subscription and a pickup scheduled today.
        const addresses = await prisma.serviceAddress.findMany({
          where: {
            isActive: true,
            subscriptions: { some: { status: { in: ACTIVE_SUB_STATUSES } } },
            schedules: { some: { pickupDayOfWeek: weekday } }
          },
          include: {
            schedules: { where: { pickupDayOfWeek: weekday } },
            user: { select: { name: true } }
          }
        });

        const stopCandidates = addresses
          .map((address) => {
            const pickup = address.schedules.find(
              (s) =>
                s.cadence === "WEEKLY" || biweeklyMatchesToday(s.biweeklyAnchorDate, now)
            );
            if (!pickup) {
              return null;
            }
            return {
              addressId: address.id,
              customerName: address.user.name,
              line1: address.line1,
              city: address.city,
              state: address.state,
              postalCode: address.postalCode,
              lat: address.lat.toNumber(),
              lng: address.lng.toNumber(),
              cans: pickup.canCount,
              rollIn: pickup.rollIn,
              cadence: pickup.cadence as "WEEKLY" | "BIWEEKLY"
            };
          })
          .filter((s): s is NonNullable<typeof s> => s !== null);

        const start = await geocodeOrThrow(input.start);
        const end = input.end && input.end.trim() ? await geocodeOrThrow(input.end.trim()) : start;

        // Nothing to route today — hand back an empty plan.
        if (stopCandidates.length === 0) {
          return jsonResponse(
            200,
            adminRouteResponseSchema.parse({
              date: now.toISOString(),
              start,
              end,
              stops: [],
              totalDistanceMeters: 0,
              totalDurationSeconds: 0,
              geometry: null
            })
          );
        }

        // Ask OpenRouteService for the optimal visiting order + route geometry.
        const optimizeRes = await fetch(`${ORS_BASE}/optimization`, {
          method: "POST",
          headers: { Authorization: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            jobs: stopCandidates.map((stop, index) => ({ id: index, location: [stop.lng, stop.lat] })),
            vehicles: [
              {
                id: 1,
                profile: "driving-car",
                start: [start.lng, start.lat],
                end: [end.lng, end.lat]
              }
            ],
            options: { g: true }
          })
        });

        if (!optimizeRes.ok) {
          const detail = await optimizeRes.text().catch(() => "");
          throw new HttpError(502, `Route optimization failed (${optimizeRes.status}): ${detail.slice(0, 200)}`);
        }

        const optimized = (await optimizeRes.json()) as {
          routes?: Array<{
            distance?: number;
            duration?: number;
            geometry?: string;
            steps?: Array<{ type?: string; job?: number }>;
          }>;
        };
        const route = optimized.routes?.[0];
        if (!route) {
          throw new HttpError(502, "Route optimization returned no route.");
        }

        const orderedStops = (route.steps ?? [])
          .filter((step) => step.type === "job" && typeof step.job === "number")
          .map((step, orderIndex) => {
            const stop = stopCandidates[step.job as number];
            return stop ? { order: orderIndex, ...stop } : null;
          })
          .filter((s): s is NonNullable<typeof s> => s !== null);

        return jsonResponse(
          200,
          adminRouteResponseSchema.parse({
            date: now.toISOString(),
            start,
            end,
            stops: orderedStops,
            totalDistanceMeters: route.distance ?? 0,
            totalDurationSeconds: route.duration ?? 0,
            geometry: route.geometry ?? null
          })
        );
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}
