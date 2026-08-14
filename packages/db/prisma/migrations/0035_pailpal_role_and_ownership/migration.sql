-- New PAILPAL role: an operator who owns their own customers (payments handled
-- offline) and builds routes only for those customers.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'PAILPAL';

-- Ownership link: the PailPal who manages this customer. Null for self-signup
-- customers and for staff accounts.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "managedById" TEXT;

DO $$ BEGIN
  ALTER TABLE "User"
    ADD CONSTRAINT "User_managedById_fkey"
    FOREIGN KEY ("managedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "User_managedById_idx" ON "User"("managedById");
