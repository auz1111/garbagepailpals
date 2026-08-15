-- Snapshot of the non-trash services due at a route stop: [{ type, options }].
-- Additive; existing stops default to an empty list.
ALTER TABLE "RouteStop" ADD COLUMN IF NOT EXISTS "services" JSONB NOT NULL DEFAULT '[]';
