-- Per-address hauler holiday shift metadata on jobs
ALTER TABLE "ServiceJob" ADD COLUMN IF NOT EXISTS "shiftedFromDate" TIMESTAMP(3);
ALTER TABLE "ServiceJob" ADD COLUMN IF NOT EXISTS "shiftReason" TEXT;

-- Cached concrete upcoming pickup dates + coords on the hauler lookup cache
ALTER TABLE "HaulerScheduleLookup" ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION;
ALTER TABLE "HaulerScheduleLookup" ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION;
ALTER TABLE "HaulerScheduleLookup" ADD COLUMN IF NOT EXISTS "upcomingPickups" JSONB;
ALTER TABLE "HaulerScheduleLookup" ADD COLUMN IF NOT EXISTS "upcomingFetchedAt" TIMESTAMP(3);
