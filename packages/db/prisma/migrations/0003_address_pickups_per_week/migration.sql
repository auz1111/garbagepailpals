-- Per-address service configuration that drives subscription pricing:
-- number of pickup days per week (default 1) and default cans raised to 2.
ALTER TABLE "ServiceAddress" ADD COLUMN "pickupsPerWeek" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ServiceAddress" ALTER COLUMN "canCount" SET DEFAULT 2;
