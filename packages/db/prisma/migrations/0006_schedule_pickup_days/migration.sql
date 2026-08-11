-- Move from a single pickup day to a list of pickup weekdays. Backfill the new
-- array from the existing primary day so current schedules keep working.
ALTER TABLE "ServiceSchedule"
  ADD COLUMN "pickupDaysOfWeek" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

UPDATE "ServiceSchedule"
  SET "pickupDaysOfWeek" = ARRAY["pickupDayOfWeek"]
  WHERE array_length("pickupDaysOfWeek", 1) IS NULL;
