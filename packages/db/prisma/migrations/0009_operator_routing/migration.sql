-- Per-operator route assignment + operator day availability.
ALTER TABLE "ServiceJob" ADD COLUMN "routeSequence" INTEGER;

CREATE TABLE "OperatorAvailability" (
  "id" TEXT NOT NULL,
  "operatorId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatorAvailability_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperatorAvailability_operatorId_date_key"
  ON "OperatorAvailability"("operatorId", "date");
CREATE INDEX "OperatorAvailability_date_idx" ON "OperatorAvailability"("date");

ALTER TABLE "OperatorAvailability"
  ADD CONSTRAINT "OperatorAvailability_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
