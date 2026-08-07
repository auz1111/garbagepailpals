import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import {
  serviceAddressInputSchema,
  serviceAddressSchema,
  serviceHoldInputSchema,
  serviceHoldSchema,
  serviceScheduleInputSchema,
  serviceScheduleSchema
} from "@gpp/shared";
import { handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../../lib/http";
import { withAuth } from "../../lib/withAuth";
import { withEntitlement } from "../../lib/withEntitlement";

function toAddressResponse(address: {
  id: string;
  userId: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  lat: { toNumber: () => number };
  lng: { toNumber: () => number };
  timezone: string;
  accessNotes: string;
  gateCode: string | null;
  canCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return serviceAddressSchema.parse({
    ...address,
    lat: address.lat.toNumber(),
    lng: address.lng.toNumber(),
    line2: address.line2 ?? undefined,
    gateCode: address.gateCode ?? undefined,
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString()
  });
}

export async function createAddressHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      withEntitlement(async (req, _ctx, auth) => {
        const input = await parseJson(req, serviceAddressInputSchema);

        const allowedArea = await prisma.serviceArea.findUnique({
          where: { postalCode: input.postalCode }
        });

        if (!allowedArea?.isActive) {
          return jsonResponse(400, { message: "Address is outside the service area" });
        }

        const created = await prisma.serviceAddress.create({
          data: {
            userId: auth.sub,
            line1: input.line1,
            line2: input.line2,
            city: input.city,
            state: input.state,
            postalCode: input.postalCode,
            lat: input.lat,
            lng: input.lng,
            timezone: input.timezone,
            accessNotes: input.accessNotes,
            gateCode: input.gateCode,
            canCount: input.canCount,
            isActive: input.isActive ?? true
          }
        });

        return jsonResponse(201, { address: toAddressResponse(created) });
      }),
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}

export async function listAddressesHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      withEntitlement(async (_req, _ctx, auth) => {
        const rows = await prisma.serviceAddress.findMany({
          where: auth.role === "ADMIN" ? undefined : { userId: auth.sub },
          orderBy: { createdAt: "desc" }
        });

        return jsonResponse(200, {
          addresses: rows.map(toAddressResponse)
        });
      }),
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}

export async function updateAddressHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      withEntitlement(async (req, _ctx, auth) => {
        const addressId = req.params.addressId;
        if (!addressId) {
          return jsonResponse(400, { message: "addressId is required" });
        }

        const input = await parseJson(req, serviceAddressInputSchema.partial());
        const existing = await prisma.serviceAddress.findUnique({ where: { id: addressId } });

        if (!existing) {
          return jsonResponse(404, { message: "Address not found" });
        }

        if (auth.role !== "ADMIN" && existing.userId !== auth.sub) {
          return jsonResponse(403, { message: "Forbidden" });
        }

        if (input.postalCode) {
          const allowedArea = await prisma.serviceArea.findUnique({ where: { postalCode: input.postalCode } });
          if (!allowedArea?.isActive) {
            return jsonResponse(400, { message: "Address is outside the service area" });
          }
        }

        const updated = await prisma.serviceAddress.update({
          where: { id: addressId },
          data: input
        });

        return jsonResponse(200, { address: toAddressResponse(updated) });
      }),
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}

export async function upsertScheduleHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      withEntitlement(async (req, _ctx, auth) => {
        const addressId = req.params.addressId;
        if (!addressId) {
          return jsonResponse(400, { message: "addressId is required" });
        }

        const address = await prisma.serviceAddress.findUnique({ where: { id: addressId } });
        if (!address) {
          return jsonResponse(404, { message: "Address not found" });
        }

        if (auth.role !== "ADMIN" && address.userId !== auth.sub) {
          return jsonResponse(403, { message: "Forbidden" });
        }

        const input = await parseJson(req, serviceScheduleInputSchema);
        if (input.cadence === "BIWEEKLY" && !input.biweeklyAnchorDate) {
          return jsonResponse(400, { message: "biweeklyAnchorDate is required for BIWEEKLY cadence" });
        }

        const upserted = await prisma.serviceSchedule.upsert({
          where: { serviceAddressId: addressId },
          create: {
            serviceAddressId: addressId,
            pickupDayOfWeek: input.pickupDayOfWeek,
            cadence: input.cadence,
            biweeklyAnchorDate: input.biweeklyAnchorDate ? new Date(input.biweeklyAnchorDate) : null,
            curbOutOffsetHours: input.curbOutOffsetHours,
            curbInOffsetHours: input.curbInOffsetHours
          },
          update: {
            pickupDayOfWeek: input.pickupDayOfWeek,
            cadence: input.cadence,
            biweeklyAnchorDate: input.biweeklyAnchorDate ? new Date(input.biweeklyAnchorDate) : null,
            curbOutOffsetHours: input.curbOutOffsetHours,
            curbInOffsetHours: input.curbInOffsetHours
          }
        });

        const response = serviceScheduleSchema.parse({
          id: upserted.id,
          serviceAddressId: upserted.serviceAddressId,
          pickupDayOfWeek: upserted.pickupDayOfWeek,
          cadence: upserted.cadence,
          biweeklyAnchorDate: upserted.biweeklyAnchorDate?.toISOString(),
          curbOutOffsetHours: upserted.curbOutOffsetHours,
          curbInOffsetHours: upserted.curbInOffsetHours,
          createdAt: upserted.createdAt.toISOString(),
          updatedAt: upserted.updatedAt.toISOString()
        });

        return jsonResponse(200, { schedule: response });
      }),
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}

export async function createHoldHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      withEntitlement(async (req, _ctx, auth) => {
        const addressId = req.params.addressId;
        if (!addressId) {
          return jsonResponse(400, { message: "addressId is required" });
        }

        const address = await prisma.serviceAddress.findUnique({ where: { id: addressId } });
        if (!address) {
          return jsonResponse(404, { message: "Address not found" });
        }

        if (auth.role !== "ADMIN" && address.userId !== auth.sub) {
          return jsonResponse(403, { message: "Forbidden" });
        }

        const input = await parseJson(req, serviceHoldInputSchema);
        if (new Date(input.endDate) < new Date(input.startDate)) {
          return jsonResponse(400, { message: "endDate must be greater than or equal to startDate" });
        }

        const created = await prisma.serviceHold.create({
          data: {
            serviceAddressId: addressId,
            startDate: new Date(input.startDate),
            endDate: new Date(input.endDate),
            reason: input.reason
          }
        });

        const response = serviceHoldSchema.parse({
          id: created.id,
          serviceAddressId: created.serviceAddressId,
          startDate: created.startDate.toISOString(),
          endDate: created.endDate.toISOString(),
          reason: created.reason,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString()
        });

        return jsonResponse(201, { hold: response });
      }),
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}

export async function listHoldsHandler(
  request: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) {
    return optionsResponse;
  }

  return withErrorBoundary(context, async () =>
    withAuth(
      withEntitlement(async (req, _ctx, auth) => {
        const addressId = req.params.addressId;
        if (!addressId) {
          return jsonResponse(400, { message: "addressId is required" });
        }

        const address = await prisma.serviceAddress.findUnique({ where: { id: addressId } });
        if (!address) {
          return jsonResponse(404, { message: "Address not found" });
        }

        if (auth.role !== "ADMIN" && address.userId !== auth.sub) {
          return jsonResponse(403, { message: "Forbidden" });
        }

        const holds = await prisma.serviceHold.findMany({
          where: { serviceAddressId: addressId },
          orderBy: { startDate: "desc" }
        });

        return jsonResponse(200, {
          holds: holds.map((hold) =>
            serviceHoldSchema.parse({
              id: hold.id,
              serviceAddressId: hold.serviceAddressId,
              startDate: hold.startDate.toISOString(),
              endDate: hold.endDate.toISOString(),
              reason: hold.reason,
              createdAt: hold.createdAt.toISOString(),
              updatedAt: hold.updatedAt.toISOString()
            })
          )
        });
      }),
      { roles: ["CUSTOMER", "ADMIN"] }
    )(request, context)
  );
}
