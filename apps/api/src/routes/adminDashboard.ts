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

type ScheduleRow = {
  pickupDayOfWeek: number;
  canCount: number;
  cadence: string;
  rollIn: boolean;
  biweeklyAnchorDate: Date | null;
};

type AddressRow = {
  id: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  neighborhoodId: string | null;
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
      neighborhoodId: address.neighborhoodId,
      monthlyCents: addressMonthlyCents(pricingDays(address.schedules)),
      pickups: [...address.schedules]
        .sort((a, b) => a.pickupDayOfWeek - b.pickupDayOfWeek)
        .map((s) => ({
          dayOfWeek: s.pickupDayOfWeek,
          cadence: s.cadence as "WEEKLY" | "BIWEEKLY",
          canCount: s.canCount,
          rollIn: s.rollIn,
          biweeklyAnchorDate: s.biweeklyAnchorDate?.toISOString()
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

        // Run sequentially and collapse related counts into single grouped
        // queries. This keeps the whole dashboard load to one DB connection at a
        // time (instead of firing ~16 counts in parallel and exhausting the
        // Postgres connection slots — see P2037).
        const NOTIFICATION_ACTIONS = [
          "notification.reminder.sent",
          "notification.reminder.failed",
          "notification.overdue.sent",
          "notification.overdue.failed"
        ];

        // Users by role in one query (total = sum of the buckets).
        const userGroups = await prisma.user.groupBy({
          by: ["role"],
          _count: { _all: true }
        });
        const roleCount = (role: string) =>
          userGroups.find((g) => g.role === role)?._count._all ?? 0;
        const totalUsers = userGroups.reduce((sum, g) => sum + g._count._all, 0);

        const addresses = await prisma.serviceAddress.count({ where: { isActive: true } });
        const activeSubscriptions = await prisma.subscription.count({ where: { status: "ACTIVE" } });
        const activeEntitlements = await prisma.entitlement.count({ where: { status: "ACTIVE" } });

        const scheduledNext7Days = await prisma.serviceJob.count({
          where: { scheduledDate: { gte: now, lte: in7Days }, status: "SCHEDULED" }
        });
        const completedLast7Days = await prisma.serviceJob.count({
          where: { completedAt: { gte: weekAgo }, status: "COMPLETED" }
        });
        const failedLast7Days = await prisma.serviceJob.count({
          where: { updatedAt: { gte: weekAgo }, status: "FAILED" }
        });

        // Webhook events (last 24h) by provider in one query.
        const webhookGroups = await prisma.webhookEvent.groupBy({
          by: ["provider"],
          where: { createdAt: { gte: dayAgo } },
          _count: { _all: true }
        });
        const providerCount = (provider: string) =>
          webhookGroups.find((g) => g.provider === provider)?._count._all ?? 0;

        // Notification audit log (last 24h) for all four actions in one query.
        const auditGroups = await prisma.auditLog.groupBy({
          by: ["action"],
          where: { action: { in: NOTIFICATION_ACTIONS }, createdAt: { gte: dayAgo } },
          _count: { _all: true }
        });
        const actionCount = (action: string) =>
          auditGroups.find((g) => g.action === action)?._count._all ?? 0;

        const response = adminDashboardMetricsSchema.parse({
          users: {
            total: totalUsers,
            customers: roleCount("CUSTOMER"),
            operators: roleCount("OPERATOR"),
            admins: roleCount("ADMIN")
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
            stripeLast24h: providerCount("stripe"),
            paypalLast24h: providerCount("paypal")
          },
          notifications: {
            remindersSentLast24h: actionCount("notification.reminder.sent"),
            remindersFailedLast24h: actionCount("notification.reminder.failed"),
            overdueSentLast24h: actionCount("notification.overdue.sent"),
            overdueFailedLast24h: actionCount("notification.overdue.failed")
          }
        });

        return jsonResponse(200, response);
      },
      { roles: ["ADMIN"] }
    )(request, context)
  );
}
