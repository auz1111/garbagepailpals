-- Per-cart breakdown on each pickup day (source of truth for pricing).
ALTER TABLE "ServiceSchedule" ADD COLUMN IF NOT EXISTS "cans" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill from the existing columns: a TRASH cart (using the day's cadence and
-- can count) plus a weekly GLASS cart when the glass add-on was on.
UPDATE "ServiceSchedule"
SET "cans" = (
  CASE
    WHEN "glassRecycling" THEN jsonb_build_array(
      jsonb_build_object('type', 'TRASH', 'cadence', "cadence"::text, 'count', "canCount"),
      jsonb_build_object('type', 'GLASS', 'cadence', 'WEEKLY', 'count', 1)
    )
    ELSE jsonb_build_array(
      jsonb_build_object('type', 'TRASH', 'cadence', "cadence"::text, 'count', "canCount")
    )
  END
)
WHERE "cans" = '[]'::jsonb OR "cans" IS NULL;
