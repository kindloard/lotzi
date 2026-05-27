-- Auth performance indexes for the OTP/session hot path.
-- These are partial indexes that match the request-path predicates exactly.

DROP INDEX IF EXISTS "otp_verifications_pending_email_purpose_created_at_desc_idx";
DROP INDEX IF EXISTS "otp_verifications_pending_user_email_purpose_created_at_desc_idx";
DROP INDEX IF EXISTS "otp_verifications_pending_user_email_purpose_created_at_desc_id";

CREATE INDEX IF NOT EXISTS "otp_pending_email_purpose_created_idx"
  ON "otp_verifications" ("email", "purpose", "created_at" DESC)
  WHERE "verified" = false;

CREATE INDEX IF NOT EXISTS "otp_pending_user_email_purpose_created_idx"
  ON "otp_verifications" ("user_id", "email", "purpose", "created_at" DESC)
  WHERE "verified" = false;

CREATE INDEX IF NOT EXISTS "sessions_active_user_seen_idx"
  ON "sessions" ("user_id", "last_seen_at" DESC)
  WHERE "revoked" = false;

CREATE INDEX IF NOT EXISTS "stores_pending_creator_name_idx"
  ON "stores" ("created_by_user_id", "name")
  WHERE "status" = 'PENDING' AND "deleted_at" IS NULL;
