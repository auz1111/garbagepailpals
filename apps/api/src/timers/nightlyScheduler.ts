import type { InvocationContext, Timer } from "@azure/functions";
import { runNightlyJobGeneration } from "../services/scheduler";

// Runs every hour; the scheduler itself computes per-address timezone windows in service logic.
export async function nightlySchedulerHandler(_timer: Timer, context: InvocationContext): Promise<void> {
  const result = await runNightlyJobGeneration();
  context.log(`Nightly scheduler completed. Jobs processed: ${result.created}`);
}
