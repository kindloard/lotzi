-- FAANG-level inventory engine foundation.
-- The new inventory tables are additive and shadow the legacy product_variants stock columns
-- during rollout, so existing checkout/dashboard reads remain backward compatible.

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'INVENTORY_CONFIRMATION_REQUIRES_REVIEW';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'INVENTORY_CONFIRMATION_REQUIRES_REVIEW';
ALTER TYPE "PaymentAttemptStatus" ADD VALUE IF NOT EXISTS 'INVENTORY_CONFIRMATION_REQUIRES_REVIEW';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InventoryLocationType') THEN
    CREATE TYPE "InventoryLocationType" AS ENUM ('STORE', 'WAREHOUSE', 'FULFILLMENT_CENTER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InventoryReservationStatus') THEN
    CREATE TYPE "InventoryReservationStatus" AS ENUM ('ACTIVE', 'CONFIRMED', 'RELEASED', 'EXPIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InventoryLedgerType') THEN
    CREATE TYPE "InventoryLedgerType" AS ENUM ('RESERVED', 'RELEASED', 'SOLD', 'REFUNDED', 'RESTOCKED', 'MANUAL_ADJUSTMENT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InventoryOperationStatus') THEN
    CREATE TYPE "InventoryOperationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "inventory_locations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "type" "InventoryLocationType" NOT NULL DEFAULT 'STORE',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_locations_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_locations_one_default_per_store_idx"
  ON "inventory_locations"("store_id")
  WHERE "is_default";
CREATE INDEX IF NOT EXISTS "inventory_locations_store_id_is_default_idx"
  ON "inventory_locations"("store_id", "is_default");

CREATE TABLE IF NOT EXISTS "inventory_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "product_variant_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "available_stock" INTEGER NOT NULL DEFAULT 0,
  "reserved_stock" INTEGER NOT NULL DEFAULT 0,
  "sold_stock" INTEGER NOT NULL DEFAULT 0,
  "low_stock_threshold" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_items_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_items_product_variant_id_fkey"
    FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_items_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_items_counters_non_negative"
    CHECK ("available_stock" >= 0 AND "reserved_stock" >= 0 AND "sold_stock" >= 0 AND "low_stock_threshold" >= 0),
  CONSTRAINT "inventory_items_version_positive"
    CHECK ("version" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_items_store_variant_location_key"
  ON "inventory_items"("store_id", "product_variant_id", "location_id");
CREATE INDEX IF NOT EXISTS "inventory_items_store_available_stock_idx"
  ON "inventory_items"("store_id", "available_stock");
CREATE INDEX IF NOT EXISTS "inventory_items_location_available_stock_idx"
  ON "inventory_items"("location_id", "available_stock");
CREATE INDEX IF NOT EXISTS "inventory_items_product_variant_location_idx"
  ON "inventory_items"("product_variant_id", "location_id");

CREATE TABLE IF NOT EXISTS "inventory_reservations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "product_variant_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" "InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "reason" TEXT,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3),
  "released_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_reservations_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_reservations_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_reservations_product_variant_id_fkey"
    FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_reservations_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_reservations_quantity_positive"
    CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_reservations_one_active_order_variant_location_idx"
  ON "inventory_reservations"("order_id", "product_variant_id", "location_id")
  WHERE "status" = 'ACTIVE';
CREATE INDEX IF NOT EXISTS "inventory_reservations_store_status_expires_at_idx"
  ON "inventory_reservations"("store_id", "status", "expires_at");
CREATE INDEX IF NOT EXISTS "inventory_reservations_order_id_status_idx"
  ON "inventory_reservations"("order_id", "status");
CREATE INDEX IF NOT EXISTS "inventory_reservations_variant_location_status_idx"
  ON "inventory_reservations"("product_variant_id", "location_id", "status");

CREATE TABLE IF NOT EXISTS "inventory_ledger" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "store_id" UUID NOT NULL,
  "product_variant_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "order_id" UUID,
  "reservation_id" UUID,
  "return_id" UUID,
  "type" "InventoryLedgerType" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "before_available_stock" INTEGER NOT NULL,
  "after_available_stock" INTEGER NOT NULL,
  "before_reserved_stock" INTEGER NOT NULL,
  "after_reserved_stock" INTEGER NOT NULL,
  "before_sold_stock" INTEGER NOT NULL,
  "after_sold_stock" INTEGER NOT NULL,
  "actor_type" TEXT NOT NULL DEFAULT 'SYSTEM',
  "actor_user_id" UUID,
  "reason" TEXT NOT NULL,
  "idempotency_key" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_ledger_pkey" PRIMARY KEY ("id", "created_at"),
  CONSTRAINT "inventory_ledger_store_id_fkey"
    FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_ledger_product_variant_id_fkey"
    FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_ledger_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_ledger_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "inventory_ledger_reservation_id_fkey"
    FOREIGN KEY ("reservation_id") REFERENCES "inventory_reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "inventory_ledger_quantity_positive"
    CHECK ("quantity" > 0),
  CONSTRAINT "inventory_ledger_counters_non_negative"
    CHECK (
      "before_available_stock" >= 0 AND "after_available_stock" >= 0 AND
      "before_reserved_stock" >= 0 AND "after_reserved_stock" >= 0 AND
      "before_sold_stock" >= 0 AND "after_sold_stock" >= 0
    )
) PARTITION BY RANGE ("created_at");

CREATE TABLE IF NOT EXISTS "inventory_ledger_default"
  PARTITION OF "inventory_ledger" DEFAULT;

CREATE INDEX IF NOT EXISTS "inventory_ledger_store_created_at_idx"
  ON "inventory_ledger"("store_id", "created_at");
CREATE INDEX IF NOT EXISTS "inventory_ledger_variant_location_created_at_idx"
  ON "inventory_ledger"("product_variant_id", "location_id", "created_at");
CREATE INDEX IF NOT EXISTS "inventory_ledger_order_created_at_idx"
  ON "inventory_ledger"("order_id", "created_at");
CREATE INDEX IF NOT EXISTS "inventory_ledger_reservation_created_at_idx"
  ON "inventory_ledger"("reservation_id", "created_at");
CREATE INDEX IF NOT EXISTS "inventory_ledger_type_created_at_idx"
  ON "inventory_ledger"("type", "created_at");

CREATE TABLE IF NOT EXISTS "inventory_operations" (
  "operation_key" TEXT NOT NULL,
  "operation_type" TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "status" "InventoryOperationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "response_json" JSONB,
  "claimed_until" TIMESTAMPTZ(3) NOT NULL,
  "heartbeat_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_operations_pkey" PRIMARY KEY ("operation_key")
);

CREATE INDEX IF NOT EXISTS "inventory_operations_status_claimed_until_idx"
  ON "inventory_operations"("status", "claimed_until");
CREATE INDEX IF NOT EXISTS "inventory_operations_type_aggregate_idx"
  ON "inventory_operations"("operation_type", "aggregate_id");
CREATE INDEX IF NOT EXISTS "inventory_operations_expires_at_idx"
  ON "inventory_operations"("expires_at");

-- Seed one default inventory location per store.
INSERT INTO "inventory_locations" ("store_id", "name", "type", "is_default", "created_at", "updated_at")
SELECT s."id", 'Default location', 'STORE'::"InventoryLocationType", true, now(), now()
FROM "stores" s
WHERE NOT EXISTS (
  SELECT 1
  FROM "inventory_locations" il
  WHERE il."store_id" = s."id"
    AND il."is_default" = true
);

-- Backfill inventory rows from the legacy variant counters.
INSERT INTO "inventory_items" (
  "store_id",
  "product_variant_id",
  "location_id",
  "available_stock",
  "reserved_stock",
  "sold_stock",
  "low_stock_threshold",
  "version",
  "created_at",
  "updated_at"
)
SELECT
  p."store_id",
  pv."id",
  il."id",
  GREATEST(pv."stock_on_hand" - pv."stock_reserved", 0),
  GREATEST(pv."stock_reserved", 0),
  0,
  0,
  GREATEST(pv."stock_version", 1),
  now(),
  now()
FROM "product_variants" pv
JOIN "products" p ON p."id" = pv."product_id"
JOIN "inventory_locations" il ON il."store_id" = p."store_id" AND il."is_default" = true
ON CONFLICT ("store_id", "product_variant_id", "location_id") DO NOTHING;

INSERT INTO "inventory_ledger" (
  "store_id",
  "product_variant_id",
  "location_id",
  "type",
  "quantity",
  "before_available_stock",
  "after_available_stock",
  "before_reserved_stock",
  "after_reserved_stock",
  "before_sold_stock",
  "after_sold_stock",
  "actor_type",
  "reason",
  "idempotency_key",
  "created_at"
)
SELECT
  ii."store_id",
  ii."product_variant_id",
  ii."location_id",
  'MANUAL_ADJUSTMENT'::"InventoryLedgerType",
  GREATEST(ii."available_stock" + ii."reserved_stock", 1),
  0,
  ii."available_stock",
  0,
  ii."reserved_stock",
  0,
  ii."sold_stock",
  'SYSTEM',
  'initial_inventory_backfill',
  CONCAT('inventory-backfill:', ii."id"::text),
  now()
FROM "inventory_items" ii
WHERE (ii."available_stock" + ii."reserved_stock") > 0
  AND NOT EXISTS (
    SELECT 1
    FROM "inventory_ledger" ledger
    WHERE ledger."product_variant_id" = ii."product_variant_id"
      AND ledger."location_id" = ii."location_id"
      AND ledger."reason" = 'initial_inventory_backfill'
  );

ALTER TABLE "inventory_locations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_ledger" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_locations_store_isolation" ON "inventory_locations";
CREATE POLICY "inventory_locations_store_isolation" ON "inventory_locations"
  FOR ALL
  USING (
    "store_id"::text = current_setting('app.current_store_id', true)
    OR current_setting('app.is_platform_admin', true) = 'true'
  )
  WITH CHECK (
    "store_id"::text = current_setting('app.current_store_id', true)
    OR current_setting('app.is_platform_admin', true) = 'true'
  );

DROP POLICY IF EXISTS "inventory_items_store_isolation" ON "inventory_items";
CREATE POLICY "inventory_items_store_isolation" ON "inventory_items"
  FOR ALL
  USING (
    "store_id"::text = current_setting('app.current_store_id', true)
    OR current_setting('app.is_platform_admin', true) = 'true'
  )
  WITH CHECK (
    "store_id"::text = current_setting('app.current_store_id', true)
    OR current_setting('app.is_platform_admin', true) = 'true'
  );

DROP POLICY IF EXISTS "inventory_reservations_store_isolation" ON "inventory_reservations";
CREATE POLICY "inventory_reservations_store_isolation" ON "inventory_reservations"
  FOR ALL
  USING (
    "store_id"::text = current_setting('app.current_store_id', true)
    OR current_setting('app.is_platform_admin', true) = 'true'
  )
  WITH CHECK (
    "store_id"::text = current_setting('app.current_store_id', true)
    OR current_setting('app.is_platform_admin', true) = 'true'
  );

DROP POLICY IF EXISTS "inventory_ledger_store_isolation" ON "inventory_ledger";
CREATE POLICY "inventory_ledger_store_isolation" ON "inventory_ledger"
  FOR ALL
  USING (
    "store_id"::text = current_setting('app.current_store_id', true)
    OR current_setting('app.is_platform_admin', true) = 'true'
  )
  WITH CHECK (
    "store_id"::text = current_setting('app.current_store_id', true)
    OR current_setting('app.is_platform_admin', true) = 'true'
  );
