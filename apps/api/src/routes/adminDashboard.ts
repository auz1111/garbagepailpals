import type { HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { prisma } from "@gpp/db";
import { adminDashboardMetricsSchema } from "@gpp/shared";
import { handleOptions, jsonResponse, withErrorBoundary } from "../lib/http";
import { withAuth } from "../lib/withAuth";

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
