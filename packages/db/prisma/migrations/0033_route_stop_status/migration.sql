-- RouteStop becomes the single record of real work: give it an explicit
-- lifecycle (PENDING when the route is built → SERVICED, or SKIPPED/FAILED) plus
-- a failure reason, replacing what ServiceJob.status used to carry.
DO $$ BEGIN
  CREATE TYPE "RouteStopStatus" AS ENUM ('PENDING', 'SERVICED', 'SKIPPED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "RouteStop" ADD COLUMN IF NOT EXISTS "status" "RouteStopStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "RouteStop" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;

-- Existing stops that were already serviced should read as SERVICED, not PENDING.
UPDATE "RouteStop"
SET "status" = 'SERVICED'
WHERE "servicedAt" IS NOT NULL
  AND "status" = 'PENDING';
