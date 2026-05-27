-- Removes deprecated onboarding preferences that are no longer collected.

ALTER TABLE "store_settings"
  DROP COLUMN IF EXISTS "shipping_preference",
  DROP COLUMN IF EXISTS "notification_preferences";

ALTER TABLE "store_branding"
  DROP COLUMN IF EXISTS "theme_preset";
