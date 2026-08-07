import type { InvocationContext, Timer } from "@azure/functions";
import { runReminderAndEscalationSweep } from "../services/reminders";

export async function reminderSweepHandler(_timer: Timer, context: InvocationContext): Promise<void> {
  const result = await runReminderAndEscalationSweep();
  context.log(
    `Reminder sweep completed. Reminders queued: ${result.remindersQueued}, overdue alerts: ${result.overdueAlerts}`
  );
}
