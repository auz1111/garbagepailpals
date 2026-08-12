-- Cache of third-party hauler pickup-schedule lookups (ReCollect, etc.)
CREATE TABLE IF NOT EXISTS "HaulerScheduleLookup" (
    "id" TEXT NOT NULL,
    "addressHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "suggestion" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HaulerScheduleLookup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HaulerScheduleLookup_addressHash_key" ON "HaulerScheduleLookup"("addressHash");

CREATE INDEX IF NOT EXISTS "HaulerScheduleLookup_provider_idx" ON "HaulerScheduleLookup"("provider");
