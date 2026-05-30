ALTER TABLE "phone_otp_verifications"
  ADD COLUMN IF NOT EXISTS "provider_raw_status" TEXT;
