-- Add nullable column to record the postal code a user requested service in
-- when we don't yet operate in their area (waitlist / notify-me).
ALTER TABLE "User" ADD COLUMN "requestedServiceArea" TEXT;
