-- New role tiers. (Postgres: new enum values can't be USED in the same tx they
-- are added, so role assignment happens later via backfill, not here.)
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PRO_OPERATOR';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';

-- Zone: a city / service region grouping neighborhoods.
CREATE TABLE IF NOT EXISTS "Zone" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "city" TEXT,
  "state" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Zone_name_key" ON "Zone"("name");

-- Neighborhood belongs to a zone.
ALTER TABLE "Neighborhood" ADD COLUMN IF NOT EXISTS "zoneId" TEXT;
CREATE INDEX IF NOT EXISTS "Neighborhood_zoneId_idx" ON "Neighborhood"("zoneId");
DO $$ BEGIN
  ALTER TABLE "Neighborhood"
    ADD CONSTRAINT "Neighborhood_zoneId_fkey"
    FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- UserZone: grants a zone to a user (admin scope and/or serviceable area).
CREATE TABLE IF NOT EXISTS "UserZone" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "serves" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserZone_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserZone_userId_zoneId_key" ON "UserZone"("userId", "zoneId");
CREATE INDEX IF NOT EXISTS "UserZone_userId_idx" ON "UserZone"("userId");
CREATE INDEX IF NOT EXISTS "UserZone_zoneId_idx" ON "UserZone"("zoneId");
DO $$ BEGIN
  ALTER TABLE "UserZone"
    ADD CONSTRAINT "UserZone_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "UserZone"
    ADD CONSTRAINT "UserZone_zoneId_fkey"
    FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
