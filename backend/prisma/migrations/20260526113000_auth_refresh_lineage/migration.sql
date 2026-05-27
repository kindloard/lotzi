ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "refresh_token_jti" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "refresh_token_parent_jti" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "refresh_token_issued_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "client_secret_hash" VARCHAR(128);

ALTER TABLE "refresh_token_history"
  ADD COLUMN IF NOT EXISTS "refresh_token_jti" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "replacement_refresh_token_jti" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "device_fingerprint" VARCHAR(128);

CREATE INDEX IF NOT EXISTS "sessions_token_family_id_refresh_token_jti_idx"
  ON "sessions"("token_family_id", "refresh_token_jti");

CREATE INDEX IF NOT EXISTS "refresh_token_history_session_id_refresh_token_jti_idx"
  ON "refresh_token_history"("session_id", "refresh_token_jti");
