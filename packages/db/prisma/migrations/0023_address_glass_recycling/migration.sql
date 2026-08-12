-- Optional glass recycling container add-on per location.
ALTER TABLE "ServiceAddress" ADD COLUMN IF NOT EXISTS "glassRecycling" BOOLEAN NOT NULL DEFAULT false;
