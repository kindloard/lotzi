CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'PaymentMethod'
      AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "PaymentMethod" AS ENUM ('CASHFREE', 'PHONEPE', 'COD');
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumtypid = '"PaymentMethod"'::regtype
        AND enumlabel = 'CASHFREE'
    ) THEN
      ALTER TYPE "PaymentMethod" ADD VALUE 'CASHFREE';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumtypid = '"PaymentMethod"'::regtype
        AND enumlabel = 'PHONEPE'
    ) THEN
      ALTER TYPE "PaymentMethod" ADD VALUE 'PHONEPE';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumtypid = '"PaymentMethod"'::regtype
        AND enumlabel = 'COD'
    ) THEN
      ALTER TYPE "PaymentMethod" ADD VALUE 'COD';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'PaymentProvider'
      AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "PaymentProvider" AS ENUM ('CASHFREE', 'PHONEPE', 'COD');
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumtypid = '"PaymentProvider"'::regtype
        AND enumlabel = 'CASHFREE'
    ) THEN
      ALTER TYPE "PaymentProvider" ADD VALUE 'CASHFREE';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumtypid = '"PaymentProvider"'::regtype
        AND enumlabel = 'PHONEPE'
    ) THEN
      ALTER TYPE "PaymentProvider" ADD VALUE 'PHONEPE';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum
      WHERE enumtypid = '"PaymentProvider"'::regtype
        AND enumlabel = 'COD'
    ) THEN
      ALTER TYPE "PaymentProvider" ADD VALUE 'COD';
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'WebhookEventStatus'
      AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DLQ', 'DUPLICATE');
  END IF;
END $$;

ALTER TABLE IF EXISTS "payments"
  ADD COLUMN IF NOT EXISTS "phonepe_transaction_id" TEXT,
  ADD COLUMN IF NOT EXISTS "gateway_provider" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "payments_phonepe_transaction_id_key"
  ON "payments" ("phonepe_transaction_id");

CREATE TABLE IF NOT EXISTS "shop_payment_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "provider" "PaymentProvider" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "display_name" TEXT,
  "display_priority" INTEGER NOT NULL DEFAULT 0,
  "merchant_id" TEXT,
  "client_id_encrypted" TEXT,
  "client_secret_encrypted" TEXT,
  "client_version" TEXT DEFAULT '1',
  "salt_key_encrypted" TEXT,
  "salt_index" TEXT,
  "environment" TEXT DEFAULT 'SANDBOX',
  "last_tested_at" TIMESTAMPTZ(3),
  "config_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shop_payment_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shop_payment_settings_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "shop_payment_settings_store_id_provider_key"
  ON "shop_payment_settings" ("store_id", "provider");
CREATE INDEX IF NOT EXISTS "shop_payment_settings_store_id_enabled_idx"
  ON "shop_payment_settings" ("store_id", "enabled");

CREATE TABLE IF NOT EXISTS "phonepe_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payment_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "merchant_transaction_id" TEXT NOT NULL,
  "phonepe_merchant_id" TEXT,
  "phonepe_transaction_id" TEXT,
  "amount_paise" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "status" TEXT NOT NULL DEFAULT 'INITIATED',
  "instrument_type" TEXT,
  "redirect_url" TEXT,
  "callback_url" TEXT,
  "gateway_request" JSONB NOT NULL DEFAULT '{}',
  "gateway_response" JSONB NOT NULL DEFAULT '{}',
  "checksum" TEXT,
  "verified_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "phonepe_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "phonepe_transactions_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "phonepe_transactions_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "phonepe_transactions_merchant_transaction_id_key"
  ON "phonepe_transactions" ("merchant_transaction_id");
CREATE UNIQUE INDEX IF NOT EXISTS "phonepe_transactions_phonepe_transaction_id_key"
  ON "phonepe_transactions" ("phonepe_transaction_id");
CREATE INDEX IF NOT EXISTS "phonepe_transactions_payment_id_status_idx"
  ON "phonepe_transactions" ("payment_id", "status");
CREATE INDEX IF NOT EXISTS "phonepe_transactions_order_id_idx"
  ON "phonepe_transactions" ("order_id");
CREATE INDEX IF NOT EXISTS "phonepe_transactions_store_id_created_at_idx"
  ON "phonepe_transactions" ("store_id", "created_at");
CREATE INDEX IF NOT EXISTS "phonepe_transactions_merchant_transaction_id_idx"
  ON "phonepe_transactions" ("merchant_transaction_id");

CREATE TABLE IF NOT EXISTS "phonepe_webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID,
  "payment_id" UUID,
  "event_type" TEXT NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "payload_hash" VARCHAR(64) NOT NULL,
  "signature_hash" VARCHAR(64),
  "headers" JSONB NOT NULL DEFAULT '{}',
  "raw_payload" JSONB NOT NULL DEFAULT '{}',
  "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_run_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_error" TEXT,
  "processed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "phonepe_webhook_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "phonepe_webhook_events_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "phonepe_webhook_events_dedupe_key_key"
  ON "phonepe_webhook_events" ("dedupe_key");
CREATE INDEX IF NOT EXISTS "phonepe_webhook_events_status_next_run_at_idx"
  ON "phonepe_webhook_events" ("status", "next_run_at");
CREATE INDEX IF NOT EXISTS "phonepe_webhook_events_event_type_created_at_idx"
  ON "phonepe_webhook_events" ("event_type", "created_at");
CREATE INDEX IF NOT EXISTS "phonepe_webhook_events_payment_id_created_at_idx"
  ON "phonepe_webhook_events" ("payment_id", "created_at");

CREATE TABLE IF NOT EXISTS "phonepe_audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "action" TEXT NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}',
  "ip_address" TEXT,
  "request_id" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "phonepe_audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "phonepe_audit_logs_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "phonepe_audit_logs_store_id_created_at_idx"
  ON "phonepe_audit_logs" ("store_id", "created_at");
CREATE INDEX IF NOT EXISTS "phonepe_audit_logs_actor_user_id_created_at_idx"
  ON "phonepe_audit_logs" ("actor_user_id", "created_at");
