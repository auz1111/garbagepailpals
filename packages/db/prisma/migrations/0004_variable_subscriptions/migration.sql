-- Support variable, plan-less subscriptions tied to an external processor
-- (Stripe/PayPal). One internal subscription per active address so the
-- scheduler can generate jobs.
ALTER TABLE "Subscription" ALTER COLUMN "planId" DROP NOT NULL;
ALTER TABLE "Subscription" ADD COLUMN "source" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "externalSubscriptionId" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "amountCents" INTEGER;
CREATE UNIQUE INDEX "Subscription_userId_serviceAddressId_key" ON "Subscription"("userId", "serviceAddressId");
