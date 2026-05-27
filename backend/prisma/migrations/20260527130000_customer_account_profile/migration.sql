-- Customer account profile foundations: safe address edits, order address snapshots,
-- and delete-account confirmation requests.

ALTER TABLE "addresses"
  ADD COLUMN IF NOT EXISTS "recipient_name" TEXT,
  ADD COLUMN IF NOT EXISTS "recipient_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "delivery_instructions" TEXT,
  ADD COLUMN IF NOT EXISTS "is_default" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(3);

CREATE INDEX IF NOT EXISTS "addresses_user_id_deleted_at_updated_at_idx"
  ON "addresses"("user_id", "deleted_at", "updated_at");

CREATE UNIQUE INDEX IF NOT EXISTS "addresses_one_default_active_per_user_idx"
  ON "addresses"("user_id")
  WHERE "deleted_at" IS NULL AND "is_default" = true;

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "address_recipient_name" TEXT,
  ADD COLUMN IF NOT EXISTS "address_recipient_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "address_line1" TEXT,
  ADD COLUMN IF NOT EXISTS "address_line2" TEXT,
  ADD COLUMN IF NOT EXISTS "address_city" TEXT,
  ADD COLUMN IF NOT EXISTS "address_state" TEXT,
  ADD COLUMN IF NOT EXISTS "address_pincode" TEXT,
  ADD COLUMN IF NOT EXISTS "address_latitude" DECIMAL(10,7),
  ADD COLUMN IF NOT EXISTS "address_longitude" DECIMAL(10,7);

UPDATE "orders" o
SET
  "address_line1" = a."line1",
  "address_line2" = a."line2",
  "address_city" = a."city",
  "address_state" = a."state",
  "address_pincode" = a."pincode",
  "address_latitude" = a."latitude",
  "address_longitude" = a."longitude",
  "address_recipient_name" = COALESCE(a."recipient_name", u."full_name"),
  "address_recipient_phone" = COALESCE(a."recipient_phone", u."phone")
FROM "addresses" a, "users" u
WHERE o."address_id" = a."id"
  AND u."id" = o."user_id";

CREATE TABLE IF NOT EXISTS "account_deletion_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "confirmation_hash" TEXT NOT NULL,
  "confirmation_nonce" TEXT NOT NULL,
  "requested_ip" TEXT,
  "consumed_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "cooldown_until" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "account_deletion_requests_user_id_consumed_at_expires_at_idx"
  ON "account_deletion_requests"("user_id", "consumed_at", "expires_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'account_deletion_requests_user_id_fkey'
  ) THEN
    ALTER TABLE "account_deletion_requests"
      ADD CONSTRAINT "account_deletion_requests_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
