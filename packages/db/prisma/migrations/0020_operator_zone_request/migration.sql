-- Operators request zones to serve; a pro-operator/super admin approves.
CREATE TABLE IF NOT EXISTS "OperatorZoneRequest" (
  "id" TEXT NOT NULL,
  "operatorId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "status" "TimeOffStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperatorZoneRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OperatorZoneRequest_operatorId_zoneId_key" ON "OperatorZoneRequest"("operatorId", "zoneId");
CREATE INDEX IF NOT EXISTS "OperatorZoneRequest_operatorId_idx" ON "OperatorZoneRequest"("operatorId");
CREATE INDEX IF NOT EXISTS "OperatorZoneRequest_zoneId_idx" ON "OperatorZoneRequest"("zoneId");
DO $$ BEGIN
  ALTER TABLE "OperatorZoneRequest"
    ADD CONSTRAINT "OperatorZoneRequest_operatorId_fkey"
    FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "OperatorZoneRequest"
    ADD CONSTRAINT "OperatorZoneRequest_zoneId_fkey"
    FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
