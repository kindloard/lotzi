-- Cashfree payment engine foundations.

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PAYMENT_CONFIRMED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PAYMENT_FAILED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'FULFILLMENT_READY';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'REFUND_PENDING';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'RETURN_REQUESTED';

ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'CASHFREE';

ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'INITIATED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'SESSION_CREATED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PENDING_GATEWAY';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'AUTHORIZED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'USER_DROPPED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'UNKNOWN_GATEWAY';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUND_PENDING';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_REFUNDED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'CHARGEBACK_OPENED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'DUPLICATE_SUCCESS_REQUIRES_REFUND';

DO $$
BEGIN
  CREATE TYPE "PaymentProvider" AS ENUM ('CASHFREE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "PaymentAttemptStatus" AS ENUM (
    'INITIATED',
    'SESSION_CREATED',
    'PENDING_GATEWAY',
    'AUTHORIZED',
    'PAID',
    'FAILED',
    'USER_DROPPED',
    'EXPIRED',
    'UNKNOWN_GATEWAY',
    'DUPLICATE_SUCCESS_REQUIRES_REFUND'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DLQ', 'DUPLICATE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "RefundStatus" AS ENUM ('INITIATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ReconciliationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'RESOLVED', 'FAILED', 'DLQ');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "ReconciliationReason" AS ENUM (
    'UNKNOWN_GATEWAY',
    'LONG_PENDING',
    'MISSING_WEBHOOK',
    'DUPLICATE_SUCCESS',
    'AMOUNT_MISMATCH',
    'STATUS_DRIFT',
    'REFUND_DRIFT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "domain_events"
  ADD COLUMN IF NOT EXISTS "schema_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
  ADD COLUMN IF NOT EXISTS "producer" TEXT NOT NULL DEFAULT 'namastore-api',
  ADD COLUMN IF NOT EXISTS "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now();

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS "pricing_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "quote_hash" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "subtotal_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discount_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tax_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "delivery_fee_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "grand_total_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "confirmed_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMPTZ(3);

UPDATE "orders"
SET
  "subtotal_paise" = CASE WHEN "subtotal_paise" = 0 THEN ROUND("subtotal" * 100)::BIGINT ELSE "subtotal_paise" END,
  "delivery_fee_paise" = CASE WHEN "delivery_fee_paise" = 0 THEN ROUND("delivery_fee" * 100)::BIGINT ELSE "delivery_fee_paise" END,
  "grand_total_paise" = CASE WHEN "grand_total_paise" = 0 THEN ROUND("total" * 100)::BIGINT ELSE "grand_total_paise" END
WHERE "subtotal_paise" = 0 OR "delivery_fee_paise" = 0 OR "grand_total_paise" = 0;

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "unit_price_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discount_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tax_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "total_paise" BIGINT NOT NULL DEFAULT 0;

UPDATE "order_items"
SET
  "unit_price_paise" = CASE WHEN "unit_price_paise" = 0 THEN ROUND("unit_price" * 100)::BIGINT ELSE "unit_price_paise" END,
  "total_paise" = CASE WHEN "total_paise" = 0 THEN ROUND("total" * 100)::BIGINT ELSE "total_paise" END
WHERE "unit_price_paise" = 0 OR "total_paise" = 0;

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "provider" "PaymentProvider" NOT NULL DEFAULT 'CASHFREE',
  ADD COLUMN IF NOT EXISTS "cashfree_order_id" TEXT,
  ADD COLUMN IF NOT EXISTS "cashfree_cf_order_id" TEXT,
  ADD COLUMN IF NOT EXISTS "cashfree_payment_id" TEXT,
  ADD COLUMN IF NOT EXISTS "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS "amount_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "refunded_paise" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
  ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "failed_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "gateway_response" JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE "payments"
SET "amount_paise" = ROUND("amount" * 100)::BIGINT
WHERE "amount_paise" = 0;

CREATE TABLE IF NOT EXISTS "checkout_sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "store_id" UUID NOT NULL,
  "order_id" UUID UNIQUE,
  "idempotency_key" TEXT NOT NULL UNIQUE,
  "request_hash" VARCHAR(64) NOT NULL,
  "quote_hash" VARCHAR(64) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "subtotal_paise" BIGINT NOT NULL,
  "discount_paise" BIGINT NOT NULL DEFAULT 0,
  "tax_paise" BIGINT NOT NULL DEFAULT 0,
  "delivery_fee_paise" BIGINT NOT NULL DEFAULT 0,
  "grand_total_paise" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CREATED',
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "payment_attempts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "attempt_number" INTEGER NOT NULL,
  "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'INITIATED',
  "cashfree_order_id" TEXT UNIQUE,
  "cashfree_cf_order_id" TEXT,
  "cashfree_payment_id" TEXT,
  "payment_session_id_hash" VARCHAR(64),
  "amount_paise" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "idempotency_key" TEXT UNIQUE,
  "gateway_request" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "gateway_response" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "expires_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "payment_attempts_order_attempt_key" UNIQUE ("order_id", "attempt_number")
);

CREATE TABLE IF NOT EXISTS "payment_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "payment_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "attempt_id" UUID,
  "event_type" TEXT NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "from_status" "PaymentStatus",
  "to_status" "PaymentStatus",
  "actor_type" TEXT NOT NULL DEFAULT 'SYSTEM',
  "actor_user_id" UUID,
  "reason" TEXT,
  "request_id" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" "PaymentProvider" NOT NULL DEFAULT 'CASHFREE',
  "payment_id" UUID,
  "event_type" TEXT NOT NULL,
  "event_version" TEXT NOT NULL DEFAULT '2025-01-01',
  "dedupe_key" TEXT NOT NULL UNIQUE,
  "payload_hash" VARCHAR(64) NOT NULL,
  "signature_hash" VARCHAR(64),
  "headers" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "raw_payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_run_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "last_error" TEXT,
  "processed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "refunds" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "refund_id" TEXT NOT NULL UNIQUE,
  "cashfree_refund_id" TEXT UNIQUE,
  "cashfree_payment_id" TEXT,
  "amount_paise" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "status" "RefundStatus" NOT NULL DEFAULT 'INITIATED',
  "reason" TEXT,
  "idempotency_key" TEXT UNIQUE,
  "gateway_response" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "processed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "order_state_transitions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id" UUID NOT NULL,
  "from_status" "OrderStatus" NOT NULL,
  "to_status" "OrderStatus" NOT NULL,
  "actor_type" TEXT NOT NULL DEFAULT 'SYSTEM',
  "actor_user_id" UUID,
  "reason" TEXT NOT NULL,
  "request_id" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "reconciliation_runs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "payment_id" UUID NOT NULL,
  "reason" "ReconciliationReason" NOT NULL,
  "status" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING',
  "drift_code" TEXT,
  "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_check_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "resolved_at" TIMESTAMPTZ(3),
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_sessions_user_id_fkey') THEN
    ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_sessions_store_id_fkey') THEN
    ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_store_id_fkey"
      FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_sessions_order_id_fkey') THEN
    ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_attempts_order_id_fkey') THEN
    ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_attempts_payment_id_fkey') THEN
    ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_fkey"
      FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_events_payment_id_fkey') THEN
    ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey"
      FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_events_order_id_fkey') THEN
    ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_events_attempt_id_fkey') THEN
    ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_attempt_id_fkey"
      FOREIGN KEY ("attempt_id") REFERENCES "payment_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_events_payment_id_fkey') THEN
    ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_payment_id_fkey"
      FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_order_id_fkey') THEN
    ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_payment_id_fkey') THEN
    ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey"
      FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_state_transitions_order_id_fkey') THEN
    ALTER TABLE "order_state_transitions" ADD CONSTRAINT "order_state_transitions_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reconciliation_runs_payment_id_fkey') THEN
    ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_payment_id_fkey"
      FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "payments_cashfree_payment_id_key" ON "payments"("cashfree_payment_id") WHERE "cashfree_payment_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "payments_cashfree_order_id_key" ON "payments"("cashfree_order_id") WHERE "cashfree_order_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "payments_idempotency_key_key" ON "payments"("idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "payment_attempts_one_active_per_order_idx"
  ON "payment_attempts"("order_id")
  WHERE "status" IN ('INITIATED', 'SESSION_CREATED', 'PENDING_GATEWAY', 'AUTHORIZED', 'UNKNOWN_GATEWAY');
CREATE INDEX IF NOT EXISTS "orders_status_payment_status_updated_at_idx" ON "orders"("status", "payment_status", "updated_at");
CREATE INDEX IF NOT EXISTS "orders_payment_status_updated_at_idx" ON "orders"("payment_status", "updated_at");
CREATE INDEX IF NOT EXISTS "payments_status_updated_at_idx" ON "payments"("status", "updated_at");
CREATE INDEX IF NOT EXISTS "payments_provider_status_updated_at_idx" ON "payments"("provider", "status", "updated_at");
CREATE INDEX IF NOT EXISTS "payment_attempts_payment_id_status_updated_at_idx" ON "payment_attempts"("payment_id", "status", "updated_at");
CREATE INDEX IF NOT EXISTS "payment_attempts_status_expires_at_idx" ON "payment_attempts"("status", "expires_at");
CREATE INDEX IF NOT EXISTS "payment_events_payment_id_created_at_idx" ON "payment_events"("payment_id", "created_at");
CREATE INDEX IF NOT EXISTS "payment_events_order_id_created_at_idx" ON "payment_events"("order_id", "created_at");
CREATE INDEX IF NOT EXISTS "payment_events_event_type_schema_version_created_at_idx" ON "payment_events"("event_type", "schema_version", "created_at");
CREATE INDEX IF NOT EXISTS "webhook_events_status_next_run_at_idx" ON "webhook_events"("status", "next_run_at");
CREATE INDEX IF NOT EXISTS "webhook_events_event_type_created_at_idx" ON "webhook_events"("event_type", "created_at");
CREATE INDEX IF NOT EXISTS "webhook_events_payment_id_created_at_idx" ON "webhook_events"("payment_id", "created_at");
CREATE INDEX IF NOT EXISTS "refunds_payment_id_status_created_at_idx" ON "refunds"("payment_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "refunds_order_id_created_at_idx" ON "refunds"("order_id", "created_at");
CREATE INDEX IF NOT EXISTS "order_state_transitions_order_id_created_at_idx" ON "order_state_transitions"("order_id", "created_at");
CREATE INDEX IF NOT EXISTS "order_state_transitions_to_status_created_at_idx" ON "order_state_transitions"("to_status", "created_at");
CREATE INDEX IF NOT EXISTS "reconciliation_runs_status_next_check_at_idx" ON "reconciliation_runs"("status", "next_check_at");
CREATE INDEX IF NOT EXISTS "reconciliation_runs_reason_status_created_at_idx" ON "reconciliation_runs"("reason", "status", "created_at");
CREATE INDEX IF NOT EXISTS "reconciliation_runs_payment_id_created_at_idx" ON "reconciliation_runs"("payment_id", "created_at");
CREATE INDEX IF NOT EXISTS "domain_events_event_type_schema_version_created_at_idx" ON "domain_events"("event_type", "schema_version", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_paise_amounts_non_negative') THEN
    ALTER TABLE "orders" ADD CONSTRAINT "orders_paise_amounts_non_negative"
      CHECK ("subtotal_paise" >= 0 AND "discount_paise" >= 0 AND "tax_paise" >= 0 AND "delivery_fee_paise" >= 0 AND "grand_total_paise" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_paise_amounts_non_negative') THEN
    ALTER TABLE "order_items" ADD CONSTRAINT "order_items_paise_amounts_non_negative"
      CHECK ("unit_price_paise" >= 0 AND "discount_paise" >= 0 AND "tax_paise" >= 0 AND "total_paise" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_paise_amounts_non_negative') THEN
    ALTER TABLE "payments" ADD CONSTRAINT "payments_paise_amounts_non_negative"
      CHECK ("amount_paise" >= 0 AND "refunded_paise" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_attempts_amount_positive') THEN
    ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_amount_positive"
      CHECK ("amount_paise" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_sessions_amount_positive') THEN
    ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_amount_positive"
      CHECK ("grand_total_paise" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'refunds_amount_positive') THEN
    ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_positive"
      CHECK ("amount_paise" > 0);
  END IF;
END $$;
