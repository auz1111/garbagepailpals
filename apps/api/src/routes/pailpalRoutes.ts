import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@gpp/db";
import { Prisma } from "@prisma/client";
import {
  adminRouteResponseSchema,
  locationApprovalSchema,
  pailpalCustomerCreateSchema,
  pailpalCustomerResponseSchema,
  pailpalCustomersResponseSchema,
  pailpalLocationCreateSchema,
  pickupScheduleSuggestionSchema,
  type ScheduleCan
} from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";
import { canActForUser } from "../lib/ownership";
import { geocodeAddressParts } from "../services/geocoding";
import { lookupPickupSchedule } from "../services/haulerSchedule";
import { schedulesFromServices } from "../services/locationServices";
import { timezoneForCoords } from "../lib/timezone";
import {
  DAILY_ROUTE_INCLUDE,
  buildRouteHistoryResponse,
  collectTodaysWork,
  serializeDailyRoute,
  todayServiceDate,
  type DailyRouteRow
} from "./adminRoutes";
import { env } from "../lib/env";

const ORS_BASE = "https://api.openrouteservice.org";

// Login-less managed customers still need a unique email for the User table's
// unique constraint; we store a placeholder in this reserved domain and treat it
// as "no email" everywhere it surfaces.
const NO_LOGIN_DOMAIN = "no-login.gpp.local";

const CUSTOMER_INCLUDE = {
  serviceAddresses: {
    orderBy: { createdAt: "asc" as const },
    include: { locationServices: { include: { days: true } } }
  }
} as const;

function serializeCustomer(user: {
  id: string;
  name: string;
  email: string;
  passwordHash: string | null;
  phone: string | null;
  createdAt: Date;
  serviceAddresses: Array<{
    id: string;
    line1: string;
    city: string;
    state: string;
    postalCode: string;
    lat: { toNumber: () => number };
    lng: { toNumber: () => number };
    isActive: boolean;
    serviceApprovedAt: Date | null;
    updatedAt: Date;
    locationServices: Array<{
      type: string;
      options: unknown;
      days: Array<{
        dayOfWeek: number;
        cadence: string;
        biweeklyAnchorDate: Date | null;
        rollIn: boolean;
        providerSynced: boolean;
        cans: unknown;
      }>;
    }>;
  }>;
}) {
  const syntheticEmail = user.email.endsWith(`@${NO_LOGIN_DOMAIN}`);
  return {
    id: user.id,
    name: user.name,
    email: syntheticEmail ? null : user.email,
    hasLogin: user.passwordHash != null,
    phone: user.phone,
    createdAt: user.createdAt.toISOString(),
    locations: user.serviceAddresses.map((a) => {
      const schedules = schedulesFromServices(a.id, a.locationServices, a.updatedAt);
      return {
        id: a.id,
        line1: a.line1,
        city: a.city,
        state: a.state,
        postalCode: a.postalCode,
        lat: a.lat.toNumber(),
        lng: a.lng.toNumber(),
        isActive: a.isActive,
        serviceApproved: a.serviceApprovedAt != null,
        pickupDays: schedules.map((s) => s.pickupDayOfWeek).sort((x, y) => x - y),
        days: schedules.map((s) => ({
          dayOfWeek: s.pickupDayOfWeek,
          cans: s.cans,
          rollIn: s.rollIn,
          petWasteDogs: s.petWasteDogs,
          providerSynced: s.providerSynced,
          biweeklyAnchorDate: s.biweeklyAnchorDate ? s.biweeklyAnchorDate.toISOString() : null
        }))
      };
    })
  };
}

// GET: the PailPal's own managed customers. POST: create one (a real login the
// PailPal sets a password for).
export async function pailpalCustomersHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        if (req.method === "POST") {
          const input = await parseJson(req, pailpalCustomerCreateSchema);
          const wantsLogin = input.addLogin === true;
          const providedEmail = input.email?.trim() || null;

          // Any real email must be unique (whether or not a login is being set).
          if (providedEmail) {
            const existing = await prisma.user.findUnique({ where: { email: providedEmail } });
            if (existing) {
              throw new HttpError(409, "That email is already in use by another account.");
            }
          }

          // No email → a placeholder so the unique constraint holds; it's treated
          // as "no email" everywhere it surfaces. A login needs a real email.
          const email = providedEmail ?? `managed-${randomUUID()}@${NO_LOGIN_DOMAIN}`;
          const passwordHash = wantsLogin ? await bcrypt.hash(input.password as string, 12) : null;

          const created = await prisma.user.create({
            data: {
              name: input.name,
              email,
              phone: input.phone ?? null,
              role: "CUSTOMER",
              managedById: auth.sub,
              passwordHash,
              authProviderId: wantsLogin ? `local:${email}` : null
            }
          });
          await prisma.auditLog.create({
            data: {
              actorUserId: auth.sub,
              action: "pailpal.customer.created",
              entityType: "User",
              entityId: created.id,
              metadata: { email: providedEmail, hasLogin: wantsLogin }
            }
          });
          const row = await prisma.user.findUnique({
            where: { id: created.id },
            include: CUSTOMER_INCLUDE
          });
          return jsonResponse(
            201,
            pailpalCustomerResponseSchema.parse({ customer: serializeCustomer(row as any) })
          );
        }

        const rows = await prisma.user.findMany({
          where: { managedById: auth.sub },
          orderBy: { createdAt: "desc" },
          include: CUSTOMER_INCLUDE
        });
        return jsonResponse(
          200,
          pailpalCustomersResponseSchema.parse({
            customers: rows.map((r) => serializeCustomer(r as any))
          })
        );
      },
      { roles: ["PAILPAL"] }
    )(request, context)
  );
}

// Create a location (address only) for a managed customer. The location starts
// with NO days of service — the PailPal adds them afterward on the location.
export async function pailpalCreateLocationHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const input = await parseJson(req, pailpalLocationCreateSchema);
        if (!(await canActForUser(auth, input.customerId))) {
          throw new HttpError(403, "You can only add locations for your own customers");
        }

        const geocoded = await geocodeAddressParts({
          line1: input.line1,
          city: input.city,
          state: input.state,
          postalCode: input.postalCode
        }).catch(() => null);
        const lat = geocoded?.lat ?? 0;
        const lng = geocoded?.lng ?? 0;
        const timezone = timezoneForCoords(lat, lng);

        const created = await prisma.serviceAddress.create({
          data: {
            userId: input.customerId,
            line1: input.line1,
            line2: input.line2 ?? null,
            city: input.city,
            state: input.state,
            postalCode: input.postalCode,
            lat,
            lng,
            timezone,
            accessNotes: "",
            canCount: 0,
            pickupsPerWeek: 0,
            rollIn: true,
            isActive: true
            // No schedules — days of service are added afterward.
          }
        });
        return jsonResponse(201, { id: created.id });
      },
      { roles: ["PAILPAL"] }
    )(request, context)
  );
}

// The PailPal approves (or un-approves) one of their own managed customers'
// locations. Unlike the admin gate, there's no billing requirement — PailPal
// customers pay offline, so approval alone makes a location routable.
export async function pailpalApproveLocationHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const addressId = req.params.addressId;
        if (!addressId) throw new HttpError(400, "addressId is required");
        const { approved } = await parseJson(req, locationApprovalSchema);

        const address = await prisma.serviceAddress.findUnique({
          where: { id: addressId },
          select: { id: true, userId: true }
        });
        if (!address) throw new HttpError(404, "Location not found");
        if (!(await canActForUser(auth, address.userId))) {
          throw new HttpError(403, "You can only approve your own customers' locations");
        }

        await prisma.serviceAddress.update({
          where: { id: addressId },
          data: {
            serviceApprovedAt: approved ? new Date() : null,
            serviceApprovedById: approved ? auth.sub : null
          }
        });
        await prisma.auditLog.create({
          data: {
            actorUserId: auth.sub,
            action: approved ? "pailpal.location.approved" : "pailpal.location.unapproved",
            entityType: "ServiceAddress",
            entityId: addressId,
            metadata: {}
          }
        });
        return jsonResponse(200, { approved });
      },
      { roles: ["PAILPAL"] }
    )(request, context)
  );
}

// Sync a managed customer's location with its trash provider: re-run the
// provider lookup (bypassing the cache) and return the matched pickup streams.
// The PailPal then reviews the suggestion and applies it via the normal
// schedule update (which persists the per-day providerSynced flags).
export async function pailpalSyncLocationProviderHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const addressId = req.params.addressId;
        if (!addressId) throw new HttpError(400, "addressId is required");

        const address = await prisma.serviceAddress.findUnique({
          where: { id: addressId },
          select: { id: true, userId: true, line1: true, city: true, state: true, postalCode: true }
        });
        if (!address) throw new HttpError(404, "Location not found");
        if (!(await canActForUser(auth, address.userId))) {
          throw new HttpError(403, "You can only sync your own customers' locations");
        }

        const suggestion = await lookupPickupSchedule(
          {
            line1: address.line1,
            city: address.city,
            state: address.state,
            postalCode: address.postalCode
          },
          { force: true }
        );
        await prisma.auditLog.create({
          data: {
            actorUserId: auth.sub,
            action: "pailpal.location.provider_synced",
            entityType: "ServiceAddress",
            entityId: addressId,
            metadata: { matched: suggestion.matched, provider: suggestion.provider ?? null }
          }
        });
        return jsonResponse(200, pickupScheduleSuggestionSchema.parse(suggestion));
      },
      { roles: ["PAILPAL"] }
    )(request, context)
  );
}

// Build today's route from the PailPal's own managed customers' due stops,
// optimized, and assign it to the PailPal themselves. They then accept/run it
// through the normal operator route flow.
export async function pailpalBuildRouteHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  return withErrorBoundary(context, async () =>
    withAuth(
      async (_req, _ctx, auth) => {
        if (!env.ORS_API_KEY) {
          throw new HttpError(400, "Routing is not configured (ORS_API_KEY missing).");
        }
        const apiKey = env.ORS_API_KEY;
        const now = new Date();
        const serviceDate = todayServiceDate(now);

        // Locations already on a route today are spoken for — skip them.
        const routedAddressIds = new Set(
          (
            await prisma.routeStop.findMany({
              where: { route: { serviceDate } },
              select: { serviceAddressId: true }
            })
          ).map((r) => r.serviceAddressId)
        );

        const work = (await collectTodaysWork(now, { ownerId: auth.sub })).filter(
          (w) => !routedAddressIds.has(w.address.id)
        );

        if (work.length === 0) {
          return jsonResponse(
            200,
            adminRouteResponseSchema.parse({
              date: now.toISOString(),
              start: null,
              end: null,
              routes: [],
              assigned: true,
              emptyReason: "none_scheduled"
            })
          );
        }

        const stops = work.map((w) => ({
          addressId: w.address.id,
          customerName: w.address.user.name,
          line1: w.address.line1,
          city: w.address.city,
          state: w.address.state,
          postalCode: w.address.postalCode,
          lat: w.address.lat.toNumber(),
          lng: w.address.lng.toNumber(),
          jobTypes: w.jobTypes,
          canCount: w.canCount,
          cans: w.cans as ScheduleCan[],
          petWasteDogs: w.petWasteDogs,
          services: w.services
        }));

        // Start from the stop nearest the cluster centroid; ORS orders the rest.
        const cx = stops.reduce((sum, s) => sum + s.lng, 0) / stops.length;
        const cy = stops.reduce((sum, s) => sum + s.lat, 0) / stops.length;
        const anchor = stops.reduce((best, s) =>
          (s.lng - cx) ** 2 + (s.lat - cy) ** 2 < (best.lng - cx) ** 2 + (best.lat - cy) ** 2 ? s : best
        );
        const start = { label: `First stop — ${anchor.line1}`, lat: anchor.lat, lng: anchor.lng };

        const optimizeRes = await fetch(`${ORS_BASE}/optimization`, {
          method: "POST",
          headers: { Authorization: apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            jobs: stops.map((stop, index) => ({ id: index, location: [stop.lng, stop.lat], amount: [1] })),
            vehicles: [
              { id: 0, profile: "driving-car", capacity: [stops.length], start: [start.lng, start.lat] }
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

        const route0 = (optimized.routes ?? [])[0];
        const orderedStops = (route0?.steps ?? [])
          .filter((step) => step.type === "job" && typeof step.job === "number")
          .map((step, orderIndex) => {
            const stop = stops[step.job as number];
            return stop ? { ...stop, order: orderIndex } : null;
          })
          .filter((s): s is NonNullable<typeof s> => s !== null);

        await prisma.dailyRoute.create({
          data: {
            serviceDate,
            operatorId: auth.sub,
            status: "ASSIGNED",
            label: "My customers",
            startLabel: start.label,
            startLat: start.lat,
            startLng: start.lng,
            distanceMeters: Math.round(route0?.distance ?? 0),
            durationSeconds: Math.round(route0?.duration ?? 0),
            geometry: route0?.geometry ?? null,
            stops: {
              create: orderedStops.map((stop) => ({
                serviceAddressId: stop.addressId,
                sequence: stop.order,
                jobTypes: [...stop.jobTypes].sort().join(","),
                canCount: stop.canCount,
                cans: stop.cans as unknown as Prisma.InputJsonValue,
                petWasteDogs: stop.petWasteDogs,
                services: stop.services as unknown as Prisma.InputJsonValue
              }))
            }
          }
        });

        return jsonResponse(
          200,
          adminRouteResponseSchema.parse({
            date: now.toISOString(),
            start,
            end: null,
            routes: [
              {
                operatorId: auth.sub,
                operatorName: null,
                stops: orderedStops.map((s) => ({
                  order: s.order,
                  addressId: s.addressId,
                  customerName: s.customerName,
                  line1: s.line1,
                  city: s.city,
                  state: s.state,
                  postalCode: s.postalCode,
                  lat: s.lat,
                  lng: s.lng,
                  jobTypes: [...s.jobTypes].sort(),
                  canCount: s.canCount,
                  cans: s.cans,
                  petWasteDogs: s.petWasteDogs
                })),
                totalDistanceMeters: route0?.distance ?? 0,
                totalDurationSeconds: route0?.duration ?? 0,
                geometry: route0?.geometry ?? null
              }
            ],
            assigned: true,
            emptyReason: null
          })
        );
      },
      { roles: ["PAILPAL"] }
    )(request, context)
  );
}

// The PailPal's own route history (only routes assigned to / run by them),
// returned in the same shape the admin history uses so the UI is shared.
export async function pailpalRouteHistoryHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;

  return withErrorBoundary(context, async () =>
    withAuth(
      async (req, _ctx, auth) => {
        const url = new URL(req.url);
        const daysParam = Number(url.searchParams.get("days"));
        const rangeDays = Number.isFinite(daysParam)
          ? Math.min(Math.max(Math.trunc(daysParam), 1), 365)
          : 30;

        const now = new Date();
        const from = new Date(todayServiceDate(now));
        from.setUTCDate(from.getUTCDate() - (rangeDays - 1));

        const rows = await prisma.dailyRoute.findMany({
          where: { operatorId: auth.sub, serviceDate: { gte: from } },
          include: DAILY_ROUTE_INCLUDE,
          orderBy: [{ serviceDate: "desc" }, { createdAt: "asc" }]
        });
        const routes = rows.map((r) => serializeDailyRoute(r as unknown as DailyRouteRow));
        return jsonResponse(200, buildRouteHistoryResponse(routes, rangeDays, now));
      },
      { roles: ["PAILPAL"] }
    )(request, context)
  );
}
