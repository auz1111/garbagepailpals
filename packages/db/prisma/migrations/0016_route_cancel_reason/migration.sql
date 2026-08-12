-- Record why/when a route was cancelled (for audit / future reference).
ALTER TABLE "DailyRoute" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "DailyRoute" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
