-- Move glass recycling from the location to each pickup day (schedule).
ALTER TABLE "ServiceSchedule" ADD COLUMN IF NOT EXISTS "glassRecycling" BOOLEAN NOT NULL DEFAULT false;

-- Carry over any location-level glass setting to that location's pickup days.
UPDATE "ServiceSchedule" s
  SET "glassRecycling" = true
  FROM "ServiceAddress" a
  WHERE s."serviceAddressId" = a."id" AND a."glassRecycling" = true;

-- Drop the location-level flag (nothing deployed reads it).
ALTER TABLE "ServiceAddress" DROP COLUMN IF EXISTS "glassRecycling";
