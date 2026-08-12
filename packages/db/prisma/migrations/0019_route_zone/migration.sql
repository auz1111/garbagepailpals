-- A route belongs to a zone (set at assignment), so assigned/history views can
-- be scoped per zone cleanly.
ALTER TABLE "DailyRoute" ADD COLUMN IF NOT EXISTS "zoneId" TEXT;
CREATE INDEX IF NOT EXISTS "DailyRoute_zoneId_idx" ON "DailyRoute"("zoneId");
