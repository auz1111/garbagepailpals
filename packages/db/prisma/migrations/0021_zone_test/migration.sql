-- Move the "test" concept from neighborhoods to zones.
-- NOTE: this migration is additive only. The old Neighborhood."isTest" column is
-- left in place (unused) so the currently-deployed code doesn't break; it can be
-- dropped in a follow-up migration once this batch is live.
ALTER TABLE "Zone" ADD COLUMN IF NOT EXISTS "isTest" BOOLEAN NOT NULL DEFAULT false;

-- Mark the Columbia, SC zone as a test zone.
UPDATE "Zone" SET "isTest" = true WHERE "name" = 'Columbia, SC';

-- Put any currently-test neighborhood into the Columbia, SC zone.
UPDATE "Neighborhood"
  SET "zoneId" = (SELECT "id" FROM "Zone" WHERE "name" = 'Columbia, SC' LIMIT 1)
  WHERE "isTest" = true
    AND EXISTS (SELECT 1 FROM "Zone" WHERE "name" = 'Columbia, SC');
