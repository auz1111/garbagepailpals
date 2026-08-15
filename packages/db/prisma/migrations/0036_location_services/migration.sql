-- Generic service model: LocationService (one per service a location has) +
-- ServiceDay (its day(s)/cadence). Additive — ServiceSchedule is untouched and
-- stays authoritative until a later migration cuts over and drops it.

-- ServiceType enum (guarded so re-runs are safe).
DO $$ BEGIN
  CREATE TYPE "ServiceType" AS ENUM ('TRASH', 'PET_WASTE', 'PLANT_WATERING', 'MAIL_CHECK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- LocationService: one row per service a location subscribes to.
CREATE TABLE IF NOT EXISTS "LocationService" (
  "id" TEXT NOT NULL,
  "serviceAddressId" TEXT NOT NULL,
  "type" "ServiceType" NOT NULL,
  "options" JSONB NOT NULL DEFAULT '{}',
  "priceCents" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LocationService_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "LocationService_serviceAddressId_idx" ON "LocationService"("serviceAddressId");
CREATE INDEX IF NOT EXISTS "LocationService_type_idx" ON "LocationService"("type");
DO $$ BEGIN
  ALTER TABLE "LocationService"
    ADD CONSTRAINT "LocationService_serviceAddressId_fkey"
    FOREIGN KEY ("serviceAddressId") REFERENCES "ServiceAddress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ServiceDay: a day (with cadence) a LocationService runs.
CREATE TABLE IF NOT EXISTS "ServiceDay" (
  "id" TEXT NOT NULL,
  "locationServiceId" TEXT NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "cadence" "Cadence" NOT NULL DEFAULT 'WEEKLY',
  "biweeklyAnchorDate" TIMESTAMP(3),
  "rollIn" BOOLEAN NOT NULL DEFAULT true,
  "providerSynced" BOOLEAN NOT NULL DEFAULT false,
  "cans" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceDay_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ServiceDay_locationServiceId_idx" ON "ServiceDay"("locationServiceId");
CREATE INDEX IF NOT EXISTS "ServiceDay_dayOfWeek_idx" ON "ServiceDay"("dayOfWeek");
DO $$ BEGIN
  ALTER TABLE "ServiceDay"
    ADD CONSTRAINT "ServiceDay_locationServiceId_fkey"
    FOREIGN KEY ("locationServiceId") REFERENCES "LocationService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
