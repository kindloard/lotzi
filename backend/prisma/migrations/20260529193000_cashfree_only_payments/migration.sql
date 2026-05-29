-- Cashfree-only payment cleanup.
-- This migration is intentionally defensive because it may be re-run after a
-- previously failed enum migration that left PaymentProvider_old in use.

DO $$
DECLARE
  labels text[];
BEGIN
  IF to_regclass('orders') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'orders'
         AND column_name = 'payment_method'
     ) THEN
    EXECUTE 'UPDATE "orders"
             SET "payment_method" = ''CASHFREE''
             WHERE "payment_method"::text IN (''COD'', ''RAZORPAY'')';
    EXECUTE 'ALTER TABLE "orders" ALTER COLUMN "payment_method" DROP DEFAULT';
  END IF;

  IF to_regclass('payments') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'payments'
         AND column_name = 'method'
     ) THEN
    EXECUTE 'UPDATE "payments"
             SET "method" = ''CASHFREE''
             WHERE "method"::text IN (''COD'', ''RAZORPAY'')';
    EXECUTE 'ALTER TABLE "payments" ALTER COLUMN "method" DROP DEFAULT';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentMethod_old') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentMethod') THEN
      CREATE TYPE "PaymentMethod" AS ENUM ('CASHFREE');
    END IF;

    IF to_regclass('orders') IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM pg_attribute
         WHERE attrelid = 'orders'::regclass
           AND attname = 'payment_method'
           AND atttypid = (SELECT oid FROM pg_type WHERE typname = 'PaymentMethod_old')
           AND NOT attisdropped
       ) THEN
      ALTER TABLE "orders"
        ALTER COLUMN "payment_method" TYPE "PaymentMethod"
        USING "payment_method"::text::"PaymentMethod";
    END IF;

    IF to_regclass('payments') IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM pg_attribute
         WHERE attrelid = 'payments'::regclass
           AND attname = 'method'
           AND atttypid = (SELECT oid FROM pg_type WHERE typname = 'PaymentMethod_old')
           AND NOT attisdropped
       ) THEN
      ALTER TABLE "payments"
        ALTER COLUMN "method" TYPE "PaymentMethod"
        USING "method"::text::"PaymentMethod";
    END IF;

    DROP TYPE IF EXISTS "PaymentMethod_old";
  ELSIF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentMethod') THEN
    SELECT array_agg(enumlabel ORDER BY enumsortorder)
      INTO labels
      FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'PaymentMethod');

    IF labels IS DISTINCT FROM ARRAY['CASHFREE']::text[] THEN
      ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
      CREATE TYPE "PaymentMethod" AS ENUM ('CASHFREE');

      IF to_regclass('orders') IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'orders'
             AND column_name = 'payment_method'
         ) THEN
        ALTER TABLE "orders"
          ALTER COLUMN "payment_method" TYPE "PaymentMethod"
          USING "payment_method"::text::"PaymentMethod";
      END IF;

      IF to_regclass('payments') IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'payments'
             AND column_name = 'method'
         ) THEN
        ALTER TABLE "payments"
          ALTER COLUMN "method" TYPE "PaymentMethod"
          USING "method"::text::"PaymentMethod";
      END IF;

      DROP TYPE "PaymentMethod_old";
    END IF;
  ELSE
    CREATE TYPE "PaymentMethod" AS ENUM ('CASHFREE');
  END IF;

  IF to_regclass('orders') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'orders'
         AND column_name = 'payment_method'
     ) THEN
    EXECUTE 'ALTER TABLE "orders" ALTER COLUMN "payment_method" SET DEFAULT ''CASHFREE''';
  END IF;

  IF to_regclass('payments') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'payments'
         AND column_name = 'method'
     ) THEN
    EXECUTE 'ALTER TABLE "payments" ALTER COLUMN "method" SET DEFAULT ''CASHFREE''';
  END IF;
END $$;

ALTER TABLE IF EXISTS "payments"
  DROP COLUMN IF EXISTS "razorpay_order_id",
  DROP COLUMN IF EXISTS "razorpay_payment_id",
  DROP COLUMN IF EXISTS "razorpay_signature";

DO $$
DECLARE
  labels text[];
BEGIN
  IF to_regclass('payments') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'payments'
         AND column_name = 'provider'
     ) THEN
    EXECUTE 'UPDATE "payments"
             SET "provider" = ''CASHFREE''
             WHERE "provider"::text IN (''COD'', ''RAZORPAY'')';
    EXECUTE 'ALTER TABLE "payments" ALTER COLUMN "provider" DROP DEFAULT';
  END IF;

  IF to_regclass('webhook_events') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'webhook_events'
         AND column_name = 'provider'
     ) THEN
    EXECUTE 'UPDATE "webhook_events"
             SET "provider" = ''CASHFREE''
             WHERE "provider"::text IN (''COD'', ''RAZORPAY'')';
    EXECUTE 'ALTER TABLE "webhook_events" ALTER COLUMN "provider" DROP DEFAULT';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentProvider_old') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentProvider') THEN
      CREATE TYPE "PaymentProvider" AS ENUM ('CASHFREE');
    END IF;

    IF to_regclass('payments') IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM pg_attribute
         WHERE attrelid = 'payments'::regclass
           AND attname = 'provider'
           AND atttypid = (SELECT oid FROM pg_type WHERE typname = 'PaymentProvider_old')
           AND NOT attisdropped
       ) THEN
      ALTER TABLE "payments"
        ALTER COLUMN "provider" TYPE "PaymentProvider"
        USING "provider"::text::"PaymentProvider";
    END IF;

    IF to_regclass('webhook_events') IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM pg_attribute
         WHERE attrelid = 'webhook_events'::regclass
           AND attname = 'provider'
           AND atttypid = (SELECT oid FROM pg_type WHERE typname = 'PaymentProvider_old')
           AND NOT attisdropped
       ) THEN
      ALTER TABLE "webhook_events"
        ALTER COLUMN "provider" TYPE "PaymentProvider"
        USING "provider"::text::"PaymentProvider";
    END IF;

    DROP TYPE IF EXISTS "PaymentProvider_old";
  ELSIF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentProvider') THEN
    SELECT array_agg(enumlabel ORDER BY enumsortorder)
      INTO labels
      FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'PaymentProvider');

    IF labels IS DISTINCT FROM ARRAY['CASHFREE']::text[] THEN
      ALTER TYPE "PaymentProvider" RENAME TO "PaymentProvider_old";
      CREATE TYPE "PaymentProvider" AS ENUM ('CASHFREE');

      IF to_regclass('payments') IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'payments'
             AND column_name = 'provider'
         ) THEN
        ALTER TABLE "payments"
          ALTER COLUMN "provider" TYPE "PaymentProvider"
          USING "provider"::text::"PaymentProvider";
      END IF;

      IF to_regclass('webhook_events') IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'webhook_events'
             AND column_name = 'provider'
         ) THEN
        ALTER TABLE "webhook_events"
          ALTER COLUMN "provider" TYPE "PaymentProvider"
          USING "provider"::text::"PaymentProvider";
      END IF;

      DROP TYPE "PaymentProvider_old";
    END IF;
  ELSE
    CREATE TYPE "PaymentProvider" AS ENUM ('CASHFREE');
  END IF;

  IF to_regclass('payments') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'payments'
         AND column_name = 'provider'
     ) THEN
    EXECUTE 'ALTER TABLE "payments" ALTER COLUMN "provider" SET DEFAULT ''CASHFREE''';
  END IF;

  IF to_regclass('webhook_events') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'webhook_events'
         AND column_name = 'provider'
     ) THEN
    EXECUTE 'ALTER TABLE "webhook_events" ALTER COLUMN "provider" SET DEFAULT ''CASHFREE''';
  END IF;
END $$;
