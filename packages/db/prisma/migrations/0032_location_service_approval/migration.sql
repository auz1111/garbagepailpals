-- A location must be approved by an admin before it's serviceable (routable /
-- counted / job-generating), even once billing is active.
ALTER TABLE "ServiceAddress" ADD COLUMN IF NOT EXISTS "serviceApprovedAt" TIMESTAMP(3);
ALTER TABLE "ServiceAddress" ADD COLUMN IF NOT EXISTS "serviceApprovedById" TEXT;

-- Grandfather locations that are already being billed (active/trialing sub) so
-- current service isn't interrupted; everything else starts pending.
UPDATE "ServiceAddress" a
SET "serviceApprovedAt" = now()
WHERE a."serviceApprovedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "Subscription" s
    WHERE s."serviceAddressId" = a."id"
      AND s."status" IN ('ACTIVE', 'TRIALING')
  );
