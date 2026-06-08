DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PhoneOtpStatus') THEN
    CREATE TYPE "PhoneOtpStatus" AS ENUM ('PENDING', 'VERIFIED', 'EXPIRED', 'FAILED', 'BLOCKED', 'CONSUMED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CheckoutOnboardingFlowStatus') THEN
    CREATE TYPE "CheckoutOnboardingFlowStatus" AS ENUM ('ADDRESS_COLLECTED', 'OTP_SENT', 'PHONE_VERIFIED', 'COMPLETED', 'EXPIRED', 'ABANDONED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OtpProviderName') THEN
    CREATE TYPE "OtpProviderName" AS ENUM ('FAST2SMS');
  END IF;
END $$;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "phone_verified_at" TIMESTAMPTZ(3);

CREATE INDEX IF NOT EXISTS "users_phone_status_idx"
  ON "users" ("phone", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "users_active_phone_unique_idx"
  ON "users" ("phone")
  WHERE "phone" IS NOT NULL
    AND "deleted_at" IS NULL
    AND "status" <> 'DELETED';

CREATE TABLE IF NOT EXISTS "checkout_onboarding_flows" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "flow_token_hash" TEXT NOT NULL,
  "idempotency_key_hash" TEXT,
  "phone_number" TEXT NOT NULL,
  "phone_proof_hash" TEXT,
  "address_ciphertext" TEXT NOT NULL,
  "address_nonce" TEXT NOT NULL,
  "next_path" TEXT NOT NULL,
  "status" "CheckoutOnboardingFlowStatus" NOT NULL DEFAULT 'ADDRESS_COLLECTED',
  "device_fingerprint_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "phone_verified_at" TIMESTAMPTZ(3),
  "consumed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "checkout_onboarding_flows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "checkout_onboarding_flows_flow_token_hash_key"
  ON "checkout_onboarding_flows" ("flow_token_hash");

CREATE UNIQUE INDEX IF NOT EXISTS "checkout_onboarding_flows_idempotency_key_hash_key"
  ON "checkout_onboarding_flows" ("idempotency_key_hash");

CREATE INDEX IF NOT EXISTS "checkout_onboarding_flows_phone_number_status_created_at_idx"
  ON "checkout_onboarding_flows" ("phone_number", "status", "created_at");

CREATE INDEX IF NOT EXISTS "checkout_onboarding_flows_status_expires_at_idx"
  ON "checkout_onboarding_flows" ("status", "expires_at");

CREATE TABLE IF NOT EXISTS "phone_otp_verifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "flow_id" UUID NOT NULL,
  "user_id" UUID,
  "phone_number" TEXT NOT NULL,
  "otp_hash" TEXT NOT NULL,
  "otp_nonce" TEXT NOT NULL,
  "otp_reference_id" TEXT NOT NULL,
  "provider" "OtpProviderName" NOT NULL DEFAULT 'FAST2SMS',
  "provider_message_id" TEXT,
  "status" "PhoneOtpStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "send_count" INTEGER NOT NULL DEFAULT 1,
  "last_attempt_at" TIMESTAMPTZ(3),
  "blocked_until" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "cooldown_until" TIMESTAMPTZ(3),
  "idempotency_key" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "phone_otp_verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "phone_otp_verifications_otp_reference_id_key"
  ON "phone_otp_verifications" ("otp_reference_id");

CREATE UNIQUE INDEX IF NOT EXISTS "phone_otp_verifications_flow_id_idempotency_key_key"
  ON "phone_otp_verifications" ("flow_id", "idempotency_key");

CREATE INDEX IF NOT EXISTS "phone_otp_verifications_phone_number_status_created_at_idx"
  ON "phone_otp_verifications" ("phone_number", "status", "created_at");

CREATE INDEX IF NOT EXISTS "phone_otp_verifications_flow_id_status_created_at_idx"
  ON "phone_otp_verifications" ("flow_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "phone_otp_verifications_status_expires_at_idx"
  ON "phone_otp_verifications" ("status", "expires_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'phone_otp_verifications_flow_id_fkey'
  ) THEN
    ALTER TABLE "phone_otp_verifications"
      ADD CONSTRAINT "phone_otp_verifications_flow_id_fkey"
      FOREIGN KEY ("flow_id") REFERENCES "checkout_onboarding_flows"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'phone_otp_verifications_user_id_fkey'
  ) THEN
    ALTER TABLE "phone_otp_verifications"
      ADD CONSTRAINT "phone_otp_verifications_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
