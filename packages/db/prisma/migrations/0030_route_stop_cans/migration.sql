-- Snapshot of the exact cans due at each route stop, so operators see which
-- carts to roll (not just a total count).
ALTER TABLE "RouteStop" ADD COLUMN IF NOT EXISTS "cans" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill legacy stops with a single TRASH cart carrying the snapshot count,
-- so existing routes still show a meaningful breakdown.
UPDATE "RouteStop"
SET "cans" = jsonb_build_array(
  jsonb_build_object('type', 'TRASH', 'cadence', 'WEEKLY', 'count', "canCount")
)
WHERE ("cans" = '[]'::jsonb OR "cans" IS NULL) AND "canCount" > 0;
