import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import bcrypt from "bcryptjs";
import { prisma } from "@gpp/db";
import { Prisma } from "@prisma/client";
import {
  adminRouteResponseSchema,
  locationApprovalSchema,
  pailpalCustomerCreateSchema,
  pailpalCustomerResponseSchema,
  pailpalCustomersResponseSchema,
  type ScheduleCan
} from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";
import { canActForUser } from "../lib/ownership";
import { collectTodaysWork, todayServiceDate } from "./adminRoutes";
import { env } from "../lib/env";

const ORS_BASE = "https://api.openrouteservice.org";

const CUSTOMER_INCLUDE = {
  serviceAddresses: {
    orderBy: { createdAt: "asc" as const },
    include: { schedules: { select: { pickupDayOfWeek: true } } }
  }
} as const;

function serializeCustomer(user: {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: Date;
  serviceAddresses: Array<{
    id: string;
    line1: string;
    city: string;
    state: string;
    postalCode: string;
    isActive: boolean;
    serviceApprovedAt: Date | null;
    schedules: Array<{ pickupDayOfWeek: number }>;
  }>;
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    createdAt: user.createdAt.toISOString(),
    locations: user.serviceAddresses.map((a) => ({
      id: a.id,
      line1: a.line1,
      city: a.city,
      state: a.state,
      postalCode: a.postalCode,
      isActive: a.isActive,
      serviceApproved: a.serviceApprovedAt != null,
      pickupDays: a.schedules.map((s) => s.pickupDayOfWeek).sort((x, y) => x - y)
    }))
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
          const existing = await prisma.user.findUnique({ where: { email: input.email } });
          if (existing) {
            throw new HttpError(409, "That email is already in use by another account.");
          }
          const passwordHash = await bcrypt.hash(input.password, 12);
          const created = await prisma.user.create({
            data: {
              name: input.name,
              email: input.email,
              phone: input.phone ?? null,
              role: "CUSTOMER",
              managedById: auth.sub,
              passwordHash,
              authProviderId: `local:${input.email}`
            }
          });
          await prisma.auditLog.create({
            data: {
              actorUserId: auth.sub,
              action: "pailpal.customer.created",
              entityType: "User",
              entityId: created.id,
              metadata: { email: input.email }
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
          petWasteDogs: w.petWasteDogs
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
                petWasteDogs: stop.petWasteDogs
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
