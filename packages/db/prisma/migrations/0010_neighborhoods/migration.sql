-- Neighborhoods: named groupings of locations used to organize routes.
CREATE TABLE "Neighborhood" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Neighborhood_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Neighborhood_name_key" ON "Neighborhood"("name");

ALTER TABLE "ServiceAddress" ADD COLUMN "neighborhoodId" TEXT;
CREATE INDEX "ServiceAddress_neighborhoodId_idx" ON "ServiceAddress"("neighborhoodId");

ALTER TABLE "ServiceAddress"
  ADD CONSTRAINT "ServiceAddress_neighborhoodId_fkey"
  FOREIGN KEY ("neighborhoodId") REFERENCES "Neighborhood"("id") ON DELETE SET NULL ON UPDATE CASCADE;
