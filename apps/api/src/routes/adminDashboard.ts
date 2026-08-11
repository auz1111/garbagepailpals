import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import bcrypt from "bcryptjs";
import { prisma } from "@gpp/db";
import {
  addressMonthlyCents,
  adminCreateUserSchema,
  adminUserResponseSchema,
  adminUserUpdateSchema,
  adminUsersResponseSchema,
  adminDashboardMetricsSchema,
  operatorAvailabilityResponseSchema,
  operatorAvailabilityUpdateSchema
} from "@gpp/shared";
import { HttpError, handleOptions, jsonResponse, parseJson, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";

const ACTIVE_SUB_STATUSES = ["ACTIVE", "TRIALING"];

const USER_AGGREGATE_INCLUDE = {
  serviceAddresses: { where: { isActive: true }, include: { schedules: true } },
  subscriptions: true
} as const;

type ScheduleRow = { pickupDayOfWeek: number; canCount: number; cadence: string; rollIn: boolean };

type AddressRow = {
  id: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  schedules: ScheduleRow[];
};

type UserAggregateRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "CUSTOMER" | "OPERATOR" | "ADMIN";
  createdAt: Date;
  requestedServiceArea: string | null;
  operatorAccess: boolean;
  serviceAddresses: AddressRow[];
  subscriptions: Array<{ status: string }>;
};

function pricingDays(schedules: ScheduleRow[]) {
  return schedules.map((s) => ({
    dayOfWeek: s.pickupDayOfWeek,
    canCount: s.canCount,
    cadence: s.cadence as "WEEKLY" | "BIWEEKLY",
    rollIn: s.rollIn
  }));
}

function toAdminUser(row: UserAggregateRow) {
  const monthlyCents = row.serviceAddresses.reduce(
    (sum, address) => sum + addressMonthlyCents(pricingDays(address.schedules)),
    0
  );
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    requestedServiceArea: row.requestedServiceArea,
    operatorAccess: row.operatorAccess,
    addressCount: row.serviceAddresses.length,
    activeSubscription: row.subscriptions.some((sub) => ACTIVE_SUB_STATUSES.includes(sub.status)),
    monthlyCents,
    locationLabels: row.serviceAddresses.map(
      (address) => `${address.line1}, ${address.city} ${address.postalCode}`
    )
  };
}

function toAdminUserDetail(row: UserAggregateRow) {
  return {
    ...toAdminUser(row),
    locations: row.serviceAddresses.map((address) => ({
      id: address.id,
      line1: address.line1,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      monthlyCents: addressMonthlyCents(pricingDays(address.schedules)),
      pickups: [...address.schedules]
        .sort((a, b) => a.pickupDayOfWeek - b.pickupDayOfWeek)
        .map((s) => ({
          dayOfWeek: s.pickupDayOfWeek,
          cadence: s.cadence as "WEEKLY" | "BIWEEKLY",
          canCount: s.canCount,
          rollIn: s.rollIn
        }))
    }))
  };
}

export async function adminUsersHandler(
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
        if (req.method === "POST") {
          const input = await parseJson(req, adminCreateUserSchema);
          const existing = await prisma.user.findUnique({ where: { email: input.email } });
          if (existing) {
            throw new HttpError(409, "That email is already in use by another account.");
          }
          const passwordHash = await bcrypt.hash(input.password, 12);
          const created = await prisma.user.create({
            data: {
              name: input.name,
              email: input.email,
              phone: input.phone,
              role: input.role,
              passwordHash,
              authProviderId: `local:${input.email}`,
              operatorAccess: input.role === "ADMIN" ? input.operatorAccess ?? false : false
            }
          });
          const row = await prisma.user.findUnique({
            where: { id: created.id },
            include: USER_AGGREGATE_INCLUDE
          });
          return jsonResponse(
            201,
            adminUserResponseSchema.parse({ user: toAdminUserDetail(row as unknown as UserAggregateRow) })
          );
        }

        const rows = await prisma.user.findMany({
          orderBy: { createdAt: "desc" },
          include: USER_AGGREGATE_INCLUDE
        });

        const users = rows.map((row) => toAdminUser(row as unknown as UserAggregateRow));
        return jsonResponse(200, adminUsersResponseSchema.parse({ users }));
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

export async function adminUserByIdHandler(
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
        const userId = req.params.userId;
        if (!userId) {
          throw new HttpError(400, "userId is required");
        }

        if (req.method === "PATCH") {
          const input = await parseJson(req, adminUserUpdateSchema);

          if (input.email) {
            const existing = await prisma.user.findUnique({ where: { email: input.email } });
            if (existing && existing.id !== userId) {
              throw new HttpError(409, "That email is already in use by another account.");
            }
          }

          await prisma.user.update({
            where: { id: userId },
            data: {
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.email !== undefined ? { email: input.email } : {}),
              ...(input.phone !== undefined ? { phone: input.phone } : {}),
              ...(input.role !== undefined ? { role: input.role } : {}),
              ...(input.requestedServiceArea !== undefined
                ? { requestedServiceArea: input.requestedServiceArea }
                : {}),
              ...(input.operatorAccess !== undefined
                ? { operatorAccess: input.operatorAccess }
                : {})
            }
          });
        }

        const row = await prisma.user.findUnique({
          where: { id: userId },
          include: USER_AGGREGATE_INCLUDE
        });
        if (!row) {
          throw new HttpError(404, "User not found");
        }

        return jsonResponse(
          200,
          adminUserResponseSchema.parse({ user: toAdminUserDetail(row as unknown as UserAggregateRow) })
        );
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

// Admin get/set of a specific operator's availability (next-30-days).
export async function adminUserAvailabilityHandler(
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
        const userId = req.params.userId;
        if (!userId) {
          throw new HttpError(400, "userId is required");
        }

        if (req.method === "PUT") {
          const { dates } = await parseJson(req, operatorAvailabilityUpdateSchema);
          const unique = [...new Set(dates)];
          await prisma.$transaction([
            prisma.operatorAvailability.deleteMany({ where: { operatorId: userId } }),
            prisma.operatorAvailability.createMany({
              data: unique.map((d) => ({ operatorId: userId, date: new Date(`${d}T00:00:00Z`) }))
            })
          ]);
          return jsonResponse(
            200,
            operatorAvailabilityResponseSchema.parse({ dates: unique.sort() })
          );
        }

        const rows = await prisma.operatorAvailability.findMany({
          where: { operatorId: userId },
          orderBy: { date: "asc" }
        });
        return jsonResponse(
          200,
          operatorAvailabilityResponseSchema.parse({
            dates: rows.map((r) => r.date.toISOString().slice(0, 10))
          })
        );
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}

export async function adminDashboardMetricsHandler(
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
        const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        const [
          totalUsers,
          customers,
          operators,
          admins,
          addresses,
          activeSubscriptions,
          activeEntitlements,
          scheduledNext7Days,
          completedLast7Days,
          failedLast7Days,
          stripeLast24h,
          paypalLast24h,
          remindersSentLast24h,
          remindersFailedLast24h,
          overdueSentLast24h,
          overdueFailedLast24h
        ] = await Promise.all([
          prisma.user.count(),
          prisma.user.count({ where: { role: "CUSTOMER" } }),
          prisma.user.count({ where: { role: "OPERATOR" } }),
          prisma.user.count({ where: { role: "ADMIN" } }),
          prisma.serviceAddress.count({ where: { isActive: true } }),
          prisma.subscription.count({ where: { status: "ACTIVE" } }),
          prisma.entitlement.count({ where: { status: "ACTIVE" } }),
          prisma.serviceJob.count({
            where: {
              scheduledDate: { gte: now, lte: in7Days },
              status: "SCHEDULED"
            }
          }),
          prisma.serviceJob.count({
            where: {
              completedAt: { gte: weekAgo },
              status: "COMPLETED"
            }
          }),
          prisma.serviceJob.count({
            where: {
              updatedAt: { gte: weekAgo },
              status: "FAILED"
            }
          }),
          prisma.webhookEvent.count({
            where: {
              provider: "stripe",
              createdAt: { gte: dayAgo }
            }
          }),
          prisma.webhookEvent.count({
            where: {
              provider: "paypal",
              createdAt: { gte: dayAgo }
            }
          }),
          prisma.auditLog.count({
            where: {
              action: "notification.reminder.sent",
              createdAt: { gte: dayAgo }
            }
          }),
          prisma.auditLog.count({
            where: {
              action: "notification.reminder.failed",
              createdAt: { gte: dayAgo }
            }
          }),
          prisma.auditLog.count({
            where: {
              action: "notification.overdue.sent",
              createdAt: { gte: dayAgo }
            }
          }),
          prisma.auditLog.count({
            where: {
              action: "notification.overdue.failed",
              createdAt: { gte: dayAgo }
            }
          })
        ]);

        const response = adminDashboardMetricsSchema.parse({
          users: {
            total: totalUsers,
            customers,
            operators,
            admins
          },
          service: {
            addresses,
            activeSubscriptions,
            activeEntitlements
          },
          jobs: {
            scheduledNext7Days,
            completedLast7Days,
            failedLast7Days
          },
          webhooks: {
            stripeLast24h,
            paypalLast24h
          },
          notifications: {
            remindersSentLast24h,
            remindersFailedLast24h,
            overdueSentLast24h,
            overdueFailedLast24h
          }
        });

        return jsonResponse(200, response);
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}
