DROP INDEX IF EXISTS "store_settings_currency_idx";

ALTER TABLE "store_settings"
  DROP COLUMN IF EXISTS "currency",
  DROP COLUMN IF EXISTS "timezone";

UPDATE "store_onboarding_drafts"
SET
  "step_payload" = "step_payload" - 'currency' - 'timezone',
  "updated_at" = now()
WHERE "step_payload" ?| ARRAY['currency', 'timezone'];
