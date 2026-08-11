-- Add per-location roll-in option (bring cans back the next day). Defaults to
-- true so existing locations keep full curb-to-curb service.
ALTER TABLE "ServiceAddress" ADD COLUMN "rollIn" BOOLEAN NOT NULL DEFAULT true;
