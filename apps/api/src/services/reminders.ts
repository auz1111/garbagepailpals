import { prisma } from "@gpp/db";

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
    }
  });

  const overdue = await prisma.serviceJob.findMany({
    where: {
      status: "SCHEDULED",
      scheduledDate: {
        lt: now
      }
    }
  });

  // Placeholder counters for Phase 4. Real push/email fan-out will be implemented with providers.
  return {
    remindersQueued: upcoming.length,
    overdueAlerts: overdue.length
  };
}
