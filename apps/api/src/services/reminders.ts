import { prisma } from "@gpp/db";
import { sendOverdueAlert, sendPickupReminder } from "./notifications";

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
  jobId: string
): Promise<Date | null> {
  const lastLog = await prisma.auditLog.findFirst({
    where: {
      action,
      entityType: "ServiceJob",
      entityId: jobId
    },
    orderBy: { createdAt: "desc" }
  });

  return lastLog?.createdAt ?? null;
}

async function writeNotificationAuditLog(args: {
  action: string;
  jobId: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: null,
      action: args.action,
      entityType: "ServiceJob",
      entityId: args.jobId,
      metadata: args.metadata as any
    }
  });
}

export async function runReminderAndEscalationSweep(now = new Date()): Promise<{
  remindersQueued: number;
  overdueAlerts: number;
}> {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const upcoming = await prisma.serviceJob.findMany({
    where: {
      status: "SCHEDULED",
      scheduledDate: {
        gte: now,
        lte: tomorrow
      }
    },
    include: {
      serviceAddress: {
        include: {
          user: true
        }
      }
    }
  });

  const overdue = await prisma.serviceJob.findMany({
    where: {
      status: "SCHEDULED",
      scheduledDate: {
        lt: now
      }
    },
    include: {
      serviceAddress: {
        include: {
          user: true
        }
      }
    }
  });

  let remindersQueued = 0;
  let overdueAlerts = 0;

  for (const job of upcoming) {
    const user = job.serviceAddress.user;
    if (!user.email) {
      continue;
    }

    const lastSentAt = await getLastSentAt("notification.reminder.sent", job.id);
    if (!shouldSendNotification(lastSentAt, 12, now)) {
      continue;
    }

    try {
      const result = await sendPickupReminder({
        customerName: user.name,
        customerEmail: user.email,
        scheduledDateIso: job.scheduledDate.toISOString(),
        addressLine1: job.serviceAddress.line1,
        city: job.serviceAddress.city,
        state: job.serviceAddress.state,
        postalCode: job.serviceAddress.postalCode
      });

      if (result.sent) {
        remindersQueued += 1;
      }

      await writeNotificationAuditLog({
        action: "notification.reminder.sent",
        jobId: job.id,
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
        jobId: job.id,
        metadata: {
          error: error instanceof Error ? error.message : "Unknown error"
        }
      });
    }
  }

  for (const job of overdue) {
    const user = job.serviceAddress.user;
    if (!user.email) {
      continue;
    }

    const lastSentAt = await getLastSentAt("notification.overdue.sent", job.id);
    if (!shouldSendNotification(lastSentAt, 24, now)) {
      continue;
    }

    try {
      const hoursOverdue = Math.max(
        1,
        Math.round((now.getTime() - job.scheduledDate.getTime()) / (60 * 60 * 1000))
      );

      const result = await sendOverdueAlert({
        customerName: user.name,
        customerEmail: user.email,
        scheduledDateIso: job.scheduledDate.toISOString(),
        addressLine1: job.serviceAddress.line1,
        city: job.serviceAddress.city,
        state: job.serviceAddress.state,
        postalCode: job.serviceAddress.postalCode,
        hoursOverdue
      });

      if (result.sent) {
        overdueAlerts += 1;
      }

      await writeNotificationAuditLog({
        action: "notification.overdue.sent",
        jobId: job.id,
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
        jobId: job.id,
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
