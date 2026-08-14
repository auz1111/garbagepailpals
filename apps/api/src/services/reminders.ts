import { prisma } from "@gpp/db";
import { sendOverdueAlert, sendPickupReminder } from "./notifications";
import { occurrenceId, projectServiceCalendar } from "./serviceCalendar";

export function shouldSendNotification(
  lastSentAt: Date | null,
  cooldownHours: number,
  now = new Date()
): boolean {
  if (!lastSentAt) {
    return true;
  }

  const elapsedMs = now.getTime() - lastSentAt.getTime();
  return elapsedMs >= cooldownHours * 60 * 60 * 1000;
}

async function getLastSentAt(
  action: string,
  entityType: string,
  entityId: string
): Promise<Date | null> {
  const lastLog = await prisma.auditLog.findFirst({
    where: {
      action,
      entityType,
      entityId
    },
    orderBy: { createdAt: "desc" }
  });

  return lastLog?.createdAt ?? null;
}

async function writeNotificationAuditLog(args: {
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: null,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      metadata: args.metadata as any
    }
  });
}

export async function runReminderAndEscalationSweep(now = new Date()): Promise<{
  remindersQueued: number;
  overdueAlerts: number;
}> {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Tomorrow's reminders come from the computed calendar (no pre-generated jobs).
  // We remind on the roll-out (the pickup itself), not the same-day roll-in.
  const occurrences = (await projectServiceCalendar(now, { throughDate: tomorrow })).filter(
    (o) => o.type === "CURB_OUT"
  );
  const addressIds = [...new Set(occurrences.map((o) => o.serviceAddressId))];
  const addresses = await prisma.serviceAddress.findMany({
    where: { id: { in: addressIds } },
    include: { user: true }
  });
  const addressById = new Map(addresses.map((a) => [a.id, a]));

  // Overdue = a stop the route planned that was never completed: still PENDING
  // after its service day has passed. This is the single record of real work, so
  // no reconciliation against a separate job table is needed.
  const todayMidnightUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const overdueStops = await prisma.routeStop.findMany({
    where: {
      status: "PENDING",
      route: { serviceDate: { lt: todayMidnightUtc } }
    },
    include: {
      route: { select: { serviceDate: true } },
      serviceAddress: { include: { user: true } }
    }
  });

  let remindersQueued = 0;
  let overdueAlerts = 0;

  for (const occurrence of occurrences) {
    const address = addressById.get(occurrence.serviceAddressId);
    if (!address) {
      continue;
    }
    const user = address.user;
    if (!user.email) {
      continue;
    }

    const entityId = occurrenceId(occurrence);
    const lastSentAt = await getLastSentAt("notification.reminder.sent", "ServiceOccurrence", entityId);
    if (!shouldSendNotification(lastSentAt, 12, now)) {
      continue;
    }

    try {
      const result = await sendPickupReminder({
        customerName: user.name,
        customerEmail: user.email,
        scheduledDateIso: occurrence.scheduledDate.toISOString(),
        addressLine1: address.line1,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode
      });

      if (result.sent) {
        remindersQueued += 1;
      }

      await writeNotificationAuditLog({
        action: "notification.reminder.sent",
        entityType: "ServiceOccurrence",
        entityId,
        metadata: {
          provider: result.provider,
          messageId: result.messageId ?? null,
          attempts: result.attempts ?? null,
          sent: result.sent
        }
      });
    } catch (error: unknown) {
      await writeNotificationAuditLog({
        action: "notification.reminder.failed",
        entityType: "ServiceOccurrence",
        entityId,
        metadata: {
          error: error instanceof Error ? error.message : "Unknown error"
        }
      });
    }
  }

  for (const stop of overdueStops) {
    const user = stop.serviceAddress.user;
    if (!user.email) {
      continue;
    }

    const lastSentAt = await getLastSentAt("notification.overdue.sent", "RouteStop", stop.id);
    if (!shouldSendNotification(lastSentAt, 24, now)) {
      continue;
    }

    try {
      const hoursOverdue = Math.max(
        1,
        Math.round((now.getTime() - stop.route.serviceDate.getTime()) / (60 * 60 * 1000))
      );

      const result = await sendOverdueAlert({
        customerName: user.name,
        customerEmail: user.email,
        scheduledDateIso: stop.route.serviceDate.toISOString(),
        addressLine1: stop.serviceAddress.line1,
        city: stop.serviceAddress.city,
        state: stop.serviceAddress.state,
        postalCode: stop.serviceAddress.postalCode,
        hoursOverdue
      });

      if (result.sent) {
        overdueAlerts += 1;
      }

      await writeNotificationAuditLog({
        action: "notification.overdue.sent",
        entityType: "RouteStop",
        entityId: stop.id,
        metadata: {
          provider: result.provider,
          messageId: result.messageId ?? null,
          attempts: result.attempts ?? null,
          sent: result.sent,
          hoursOverdue
        }
      });
    } catch (error: unknown) {
      await writeNotificationAuditLog({
        action: "notification.overdue.failed",
        entityType: "RouteStop",
        entityId: stop.id,
        metadata: {
          error: error instanceof Error ? error.message : "Unknown error"
        }
      });
    }
  }

  return {
    remindersQueued,
    overdueAlerts
  };
}
