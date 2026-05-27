DO $$
BEGIN
  CREATE TYPE "UnitGroup" AS ENUM ('WEIGHT', 'VOLUME', 'COUNT', 'LENGTH', 'AREA', 'BUNDLE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "MeasurementUnit" AS ENUM (
    'MG',
    'G',
    'KG',
    'TONNE',
    'ML',
    'LITRE',
    'GALLON',
    'PIECE',
    'PAIR',
    'DOZEN',
    'CM',
    'METER',
    'INCH',
    'FEET',
    'SQ_FT',
    'SQ_METER'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "PackType" AS ENUM (
    'UNIT',
    'PACK',
    'PACKET',
    'BOX',
    'CARTON',
    'BOTTLE',
    'POUCH',
    'JAR',
    'CAN',
    'SACHET',
    'STRIP',
    'BAG',
    'TRAY',
    'BUNCH',
    'BUNDLE',
    'SET'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "StockReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'FINALIZED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "unit_group" "UnitGroup" NOT NULL DEFAULT 'COUNT',
  ADD COLUMN IF NOT EXISTS "quantity_value" DECIMAL(12,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "quantity_unit" "MeasurementUnit" NOT NULL DEFAULT 'PIECE',
  ADD COLUMN IF NOT EXISTS "normalized_value" DECIMAL(14,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "normalized_unit" "MeasurementUnit" NOT NULL DEFAULT 'PIECE',
  ADD COLUMN IF NOT EXISTS "pack_type" "PackType" NOT NULL DEFAULT 'UNIT',
  ADD COLUMN IF NOT EXISTS "price_per_base_unit" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "product_variants"
  ADD COLUMN IF NOT EXISTS "mrp" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "cost_price" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "price_per_base_unit" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "stock_on_hand" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "stock_reserved" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "stock_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "unit_group" "UnitGroup" NOT NULL DEFAULT 'COUNT',
  ADD COLUMN IF NOT EXISTS "quantity_value" DECIMAL(12,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "quantity_unit" "MeasurementUnit" NOT NULL DEFAULT 'PIECE',
  ADD COLUMN IF NOT EXISTS "normalized_value" DECIMAL(14,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "normalized_unit" "MeasurementUnit" NOT NULL DEFAULT 'PIECE',
  ADD COLUMN IF NOT EXISTS "pack_type" "PackType" NOT NULL DEFAULT 'UNIT';

INSERT INTO "product_variants" (
  "product_id",
  "name",
  "sku",
  "price",
  "mrp",
  "stock",
  "stock_on_hand",
  "unit_group",
  "quantity_value",
  "quantity_unit",
  "normalized_value",
  "normalized_unit",
  "pack_type",
  "created_at",
  "updated_at"
)
SELECT
  p."id",
  'Default',
  p."sku",
  p."price",
  p."compare_at_price",
  p."stock",
  p."stock",
  'COUNT',
  1,
  'PIECE',
  1,
  'PIECE',
  'UNIT',
  now(),
  now()
FROM "products" p
WHERE NOT EXISTS (
  SELECT 1 FROM "product_variants" pv WHERE pv."product_id" = p."id"
);

UPDATE "product_variants"
SET "stock_on_hand" = "stock"
WHERE "stock_on_hand" = 0 AND "stock" > 0;

UPDATE "product_variants"
SET "price_per_base_unit" = "price"
WHERE "price_per_base_unit" = 0
  AND "unit_group" = 'COUNT'
  AND "quantity_value" = 1
  AND "quantity_unit" = 'PIECE';

UPDATE "products"
SET "price_per_base_unit" = "price"
WHERE "price_per_base_unit" = 0
  AND "unit_group" = 'COUNT'
  AND "quantity_value" = 1
  AND "quantity_unit" = 'PIECE';

ALTER TABLE "cart_items"
  ADD COLUMN IF NOT EXISTS "variant_id" UUID;

ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "variant_id" UUID,
  ADD COLUMN IF NOT EXISTS "variant_name" TEXT,
  ADD COLUMN IF NOT EXISTS "unit_display" TEXT,
  ADD COLUMN IF NOT EXISTS "quantity_value" DECIMAL(12,4),
  ADD COLUMN IF NOT EXISTS "quantity_unit" "MeasurementUnit",
  ADD COLUMN IF NOT EXISTS "pack_type" "PackType",
  ADD COLUMN IF NOT EXISTS "mrp" DECIMAL(10,2);

UPDATE "cart_items" ci
SET "variant_id" = pv.id
FROM "product_variants" pv
WHERE ci."variant_id" IS NULL
  AND pv."product_id" = ci."product_id"
  AND pv.id = (
    SELECT pv2.id
    FROM "product_variants" pv2
    WHERE pv2."product_id" = ci."product_id"
    ORDER BY pv2."created_at" ASC
    LIMIT 1
  );

UPDATE "order_items" oi
SET
  "variant_id" = pv.id,
  "variant_name" = COALESCE(oi."variant_name", pv."name"),
  "quantity_value" = COALESCE(oi."quantity_value", pv."quantity_value"),
  "quantity_unit" = COALESCE(oi."quantity_unit", pv."quantity_unit"),
  "pack_type" = COALESCE(oi."pack_type", pv."pack_type"),
  "mrp" = COALESCE(oi."mrp", pv."mrp")
FROM "product_variants" pv
WHERE oi."variant_id" IS NULL
  AND pv."product_id" = oi."product_id"
  AND pv.id = (
    SELECT pv2.id
    FROM "product_variants" pv2
    WHERE pv2."product_id" = oi."product_id"
    ORDER BY pv2."created_at" ASC
    LIMIT 1
  );

CREATE TABLE IF NOT EXISTS "stock_reservations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "order_id" UUID,
  "product_variant_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" "StockReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "reason" TEXT,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "released_at" TIMESTAMPTZ(3),
  "finalized_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_reservations_user_id_fkey') THEN
    ALTER TABLE "stock_reservations"
      ADD CONSTRAINT "stock_reservations_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_reservations_order_id_fkey') THEN
    ALTER TABLE "stock_reservations"
      ADD CONSTRAINT "stock_reservations_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_reservations_product_variant_id_fkey') THEN
    ALTER TABLE "stock_reservations"
      ADD CONSTRAINT "stock_reservations_product_variant_id_fkey"
      FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_variant_id_fkey') THEN
    ALTER TABLE "cart_items"
      ADD CONSTRAINT "cart_items_variant_id_fkey"
      FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_variant_id_fkey') THEN
    ALTER TABLE "order_items"
      ADD CONSTRAINT "order_items_variant_id_fkey"
      FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DROP INDEX IF EXISTS "cart_items_cart_id_product_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "cart_items_cart_id_product_id_variant_id_key"
  ON "cart_items"("cart_id", "product_id", "variant_id");

CREATE INDEX IF NOT EXISTS "products_unit_group_quantity_unit_idx" ON "products"("unit_group", "quantity_unit");
CREATE INDEX IF NOT EXISTS "product_variants_unit_group_quantity_unit_idx" ON "product_variants"("unit_group", "quantity_unit");
CREATE INDEX IF NOT EXISTS "product_variants_stock_on_hand_stock_reserved_idx" ON "product_variants"("stock_on_hand", "stock_reserved");
CREATE INDEX IF NOT EXISTS "cart_items_variant_id_idx" ON "cart_items"("variant_id");
CREATE INDEX IF NOT EXISTS "order_items_variant_id_idx" ON "order_items"("variant_id");
CREATE INDEX IF NOT EXISTS "stock_reservations_product_variant_id_status_idx" ON "stock_reservations"("product_variant_id", "status");
CREATE INDEX IF NOT EXISTS "stock_reservations_status_expires_at_idx" ON "stock_reservations"("status", "expires_at");
CREATE INDEX IF NOT EXISTS "stock_reservations_user_id_status_idx" ON "stock_reservations"("user_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_stock_non_negative') THEN
    ALTER TABLE "product_variants"
      ADD CONSTRAINT "product_variants_stock_non_negative"
      CHECK ("stock_on_hand" >= 0 AND "stock_reserved" >= 0 AND "stock" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_quantity_positive') THEN
    ALTER TABLE "product_variants"
      ADD CONSTRAINT "product_variants_quantity_positive"
      CHECK ("quantity_value" > 0 AND "normalized_value" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_price_valid') THEN
    ALTER TABLE "product_variants"
      ADD CONSTRAINT "product_variants_price_valid"
      CHECK ("price" >= 0 AND ("mrp" IS NULL OR "mrp" >= "price") AND ("cost_price" IS NULL OR "cost_price" >= 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_measurement_quantity_positive') THEN
    ALTER TABLE "products"
      ADD CONSTRAINT "products_measurement_quantity_positive"
      CHECK ("quantity_value" > 0 AND "normalized_value" > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_reservations_quantity_positive') THEN
    ALTER TABLE "stock_reservations"
      ADD CONSTRAINT "stock_reservations_quantity_positive"
      CHECK ("quantity" > 0);
  END IF;
END $$;
