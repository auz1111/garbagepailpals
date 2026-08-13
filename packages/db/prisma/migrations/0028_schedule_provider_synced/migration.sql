-- Per-day flag: is this pickup day synced to the connected trash provider's day?
ALTER TABLE "ServiceSchedule" ADD COLUMN IF NOT EXISTS "providerSynced" BOOLEAN NOT NULL DEFAULT false;
