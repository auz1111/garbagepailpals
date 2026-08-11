-- Each ServiceSchedule row is now a single pickup day (weekday + cadence + cans +
-- roll-in). Many rows per address, replacing the one-schedule-per-address model.

ALTER TABLE "ServiceSchedule" ADD COLUMN "canCount" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "ServiceSchedule" ADD COLUMN "rollIn" BOOLEAN NOT NULL DEFAULT true;

-- Cans/roll-in used to live on the address; carry them onto the existing day.
UPDATE "ServiceSchedule" s
  SET "canCount" = a."canCount", "rollIn" = a."rollIn"
  FROM "ServiceAddress" a
  WHERE a.id = s."serviceAddressId";

-- Superseded by per-day rows.
ALTER TABLE "ServiceSchedule" DROP COLUMN "pickupDaysOfWeek";

-- One row per (address, weekday) instead of one schedule per address.
DROP INDEX "ServiceSchedule_serviceAddressId_key";
DROP INDEX "ServiceSchedule_pickupDayOfWeek_idx";
CREATE UNIQUE INDEX "ServiceSchedule_serviceAddressId_pickupDayOfWeek_key"
  ON "ServiceSchedule"("serviceAddressId", "pickupDayOfWeek");
CREATE INDEX "ServiceSchedule_serviceAddressId_idx" ON "ServiceSchedule"("serviceAddressId");

ALTER TABLE "ServiceSchedule" ALTER COLUMN "cadence" SET DEFAULT 'WEEKLY';

-- Guarantee every location has at least one pickup day (default Tuesday weekly).
INSERT INTO "ServiceSchedule" (
  id, "serviceAddressId", "pickupDayOfWeek", cadence, "canCount", "rollIn",
  "curbOutOffsetHours", "curbInOffsetHours", "createdAt", "updatedAt"
)
SELECT gen_random_uuid()::text, a.id, 2, 'WEEKLY', a."canCount", a."rollIn", -12, 8, now(), now()
FROM "ServiceAddress" a
WHERE NOT EXISTS (
  SELECT 1 FROM "ServiceSchedule" s WHERE s."serviceAddressId" = a.id
);
