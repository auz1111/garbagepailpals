-- Per-item service verification on each route stop: a pet-waste snapshot so it
-- shows as its own step, and the operator's completed checklist (one entry per
-- can/service, each with up to 3 photo blob paths).
ALTER TABLE "RouteStop" ADD COLUMN IF NOT EXISTS "petWasteDogs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RouteStop" ADD COLUMN IF NOT EXISTS "serviceVerification" JSONB NOT NULL DEFAULT '[]'::jsonb;
