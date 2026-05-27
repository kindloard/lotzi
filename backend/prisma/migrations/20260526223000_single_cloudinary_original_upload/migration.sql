DROP INDEX IF EXISTS "upload_asset_renditions_provider_provider_public_id_key";

ALTER TABLE "upload_assets"
  ADD COLUMN IF NOT EXISTS "original_provider_public_id" TEXT,
  ADD COLUMN IF NOT EXISTS "original_secure_url" TEXT,
  ADD COLUMN IF NOT EXISTS "cleanup_attempted_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "cleanup_succeeded_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "cleanup_attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cleanup_last_error" TEXT;

ALTER TABLE "upload_asset_renditions"
  ADD COLUMN IF NOT EXISTS "transformation" TEXT,
  ALTER COLUMN "provider_public_id" DROP NOT NULL,
  ALTER COLUMN "bytes" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "upload_assets_original_provider_public_id_idx"
  ON "upload_assets"("original_provider_public_id");

CREATE INDEX IF NOT EXISTS "upload_assets_cleanup_succeeded_at_cleanup_attempt_count_idx"
  ON "upload_assets"("cleanup_succeeded_at", "cleanup_attempt_count");

CREATE INDEX IF NOT EXISTS "upload_asset_renditions_provider_provider_public_id_idx"
  ON "upload_asset_renditions"("provider", "provider_public_id");
