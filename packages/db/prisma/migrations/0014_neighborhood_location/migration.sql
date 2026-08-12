-- AddColumns
ALTER TABLE "Neighborhood" ADD COLUMN "city" TEXT;
ALTER TABLE "Neighborhood" ADD COLUMN "state" TEXT;
ALTER TABLE "Neighborhood" ADD COLUMN "zipCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
