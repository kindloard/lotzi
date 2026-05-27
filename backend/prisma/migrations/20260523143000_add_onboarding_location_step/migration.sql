-- Adds GPS capture as a first-class onboarding step.
-- Keep ALTER TYPE statements standalone. Do not wrap this migration in BEGIN/COMMIT:
-- PostgreSQL enum value additions have transaction/rollback restrictions on older versions.

ALTER TYPE "OnboardingStep" ADD VALUE IF NOT EXISTS 'LOCATION' BEFORE 'PREFERENCES';

ALTER TYPE "OnboardingLifecycleState" ADD VALUE IF NOT EXISTS 'LOCATION_DONE' BEFORE 'PREFS_DONE';

ALTER TABLE "store_onboarding_states"
  ADD COLUMN IF NOT EXISTS "location_completed_at" TIMESTAMPTZ(3);
