-- Flag a neighborhood as a test neighborhood (excluded from the real service area).
ALTER TABLE "Neighborhood" ADD COLUMN IF NOT EXISTS "isTest" BOOLEAN NOT NULL DEFAULT false;
