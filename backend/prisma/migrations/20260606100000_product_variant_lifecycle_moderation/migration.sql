DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductVariantStatus') THEN
    CREATE TYPE "ProductVariantStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UploadModerationStatus') THEN
    CREATE TYPE "UploadModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NEEDS_REVIEW');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CartItemAvailabilityStatus') THEN
    CREATE TYPE "CartItemAvailabilityStatus" AS ENUM ('AVAILABLE', 'UNAVAILABLE_VARIANT_ARCHIVED');
  END IF;
END $$;

ALTER TABLE "product_variants"
  ADD COLUMN IF NOT EXISTS "status" "ProductVariantStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(3);

ALTER TABLE "upload_assets"
  ADD COLUMN IF NOT EXISTS "moderation_status" "UploadModerationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "moderation_checked_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "moderation_reason" TEXT;

UPDATE "upload_assets"
SET
  "moderation_status" = 'APPROVED',
  "moderation_checked_at" = COALESCE("moderation_checked_at", now()),
  "moderation_reason" = COALESCE("moderation_reason", 'backfilled_existing_ready_asset')
WHERE "status" IN ('READY', 'ATTACHED')
  AND "moderation_status" = 'PENDING';

ALTER TABLE "cart_items"
  ADD COLUMN IF NOT EXISTS "availability_status" "CartItemAvailabilityStatus" NOT NULL DEFAULT 'AVAILABLE',
  ADD COLUMN IF NOT EXISTS "unavailable_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "unavailable_at" TIMESTAMPTZ(3);

WITH ranked_defaults AS (
  SELECT
    id,
    product_id,
    ROW_NUMBER() OVER (
      PARTITION BY product_id
      ORDER BY is_default DESC, position ASC, created_at ASC, id ASC
    ) AS rank
  FROM "product_variants"
  WHERE "status" = 'ACTIVE'
)
UPDATE "product_variants" pv
SET "is_default" = false
FROM ranked_defaults ranked
WHERE pv.id = ranked.id
  AND ranked.rank > 1
  AND pv."is_default" = true;

WITH ranked_active AS (
  SELECT
    pv.id,
    pv.product_id,
    ROW_NUMBER() OVER (
      PARTITION BY pv.product_id
      ORDER BY
        CASE
          WHEN
            COALESCE(p.sku, '') = COALESCE(pv.sku, '')
            AND p.price = pv.price
            AND COALESCE(p.compare_at_price, 0) = COALESCE(pv.mrp, 0)
            AND p.stock = pv.stock
          THEN 0
          ELSE 1
        END,
        pv.position ASC,
        pv.created_at ASC,
        pv.id ASC
    ) AS rank
  FROM "product_variants" pv
  JOIN "products" p ON p.id = pv.product_id
  WHERE pv."status" = 'ACTIVE'
    AND NOT EXISTS (
      SELECT 1
      FROM "product_variants" existing_default
      WHERE existing_default.product_id = pv.product_id
        AND existing_default."status" = 'ACTIVE'
        AND existing_default.is_default = true
    )
)
UPDATE "product_variants" pv
SET "is_default" = true,
    "position" = 0
FROM ranked_active ranked
WHERE pv.id = ranked.id
  AND ranked.rank = 1;

DO $$
DECLARE
  missing_defaults integer;
  duplicate_defaults integer;
BEGIN
  SELECT COUNT(*) INTO missing_defaults
  FROM "products" p
  WHERE EXISTS (
    SELECT 1
    FROM "product_variants" pv
    WHERE pv.product_id = p.id
      AND pv."status" = 'ACTIVE'
  )
    AND NOT EXISTS (
      SELECT 1
      FROM "product_variants" pv
      WHERE pv.product_id = p.id
        AND pv."status" = 'ACTIVE'
        AND pv.is_default = true
    );

  SELECT COUNT(*) INTO duplicate_defaults
  FROM (
    SELECT product_id
    FROM "product_variants"
    WHERE "status" = 'ACTIVE'
      AND is_default = true
    GROUP BY product_id
    HAVING COUNT(*) > 1
  ) duplicates;

  IF missing_defaults > 0 THEN
    RAISE EXCEPTION 'Default variant repair failed: % products have active variants but no active default', missing_defaults;
  END IF;

  IF duplicate_defaults > 0 THEN
    RAISE EXCEPTION 'Default variant repair failed: % products have duplicate active defaults', duplicate_defaults;
  END IF;
END $$;

WITH primary_ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY product_id
      ORDER BY sort_order ASC, created_at ASC, id ASC
    ) AS rank
  FROM "product_images"
  WHERE is_primary = true
)
UPDATE "product_images" pi
SET is_primary = false
FROM primary_ranked ranked
WHERE pi.id = ranked.id
  AND ranked.rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "product_images_one_primary_per_product_idx"
  ON "product_images"("product_id")
  WHERE "is_primary" = true;

CREATE INDEX IF NOT EXISTS "product_variants_product_status_default_position_idx"
  ON "product_variants"("product_id", "status", "is_default", "position");

CREATE INDEX IF NOT EXISTS "product_variants_status_archived_at_idx"
  ON "product_variants"("status", "archived_at");

CREATE INDEX IF NOT EXISTS "upload_assets_store_purpose_moderation_idx"
  ON "upload_assets"("store_id", "purpose", "moderation_status");

CREATE INDEX IF NOT EXISTS "cart_items_availability_unavailable_at_idx"
  ON "cart_items"("availability_status", "unavailable_at");

CREATE TABLE IF NOT EXISTS "variant_inventory_summary" (
  "store_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "product_variant_id" UUID NOT NULL,
  "available_stock" INTEGER NOT NULL DEFAULT 0,
  "reserved_stock" INTEGER NOT NULL DEFAULT 0,
  "sold_stock" INTEGER NOT NULL DEFAULT 0,
  "in_stock" BOOLEAN NOT NULL DEFAULT false,
  "variant_status" "ProductVariantStatus" NOT NULL DEFAULT 'ACTIVE',
  "stock_version" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "variant_inventory_summary_pkey" PRIMARY KEY ("store_id", "product_variant_id")
);

INSERT INTO "variant_inventory_summary" (
  "store_id",
  "product_id",
  "product_variant_id",
  "available_stock",
  "reserved_stock",
  "sold_stock",
  "in_stock",
  "variant_status",
  "stock_version",
  "updated_at"
)
SELECT
  p.store_id,
  p.id,
  pv.id,
  GREATEST(COALESCE(SUM(ii.available_stock), pv.stock_on_hand - pv.stock_reserved, 0), 0)::integer,
  GREATEST(COALESCE(SUM(ii.reserved_stock), pv.stock_reserved, 0), 0)::integer,
  GREATEST(COALESCE(SUM(ii.sold_stock), 0), 0)::integer,
  GREATEST(COALESCE(SUM(ii.available_stock), pv.stock_on_hand - pv.stock_reserved, 0), 0) > 0
    AND pv.status = 'ACTIVE',
  pv.status,
  GREATEST(COALESCE(MAX(ii.version), pv.stock_version, 1), 1)::integer,
  now()
FROM "product_variants" pv
JOIN "products" p ON p.id = pv.product_id
LEFT JOIN "inventory_items" ii
  ON ii.product_variant_id = pv.id
 AND ii.store_id = p.store_id
GROUP BY
  p.store_id,
  p.id,
  pv.id,
  pv.stock_on_hand,
  pv.stock_reserved,
  pv.status,
  pv.stock_version
ON CONFLICT ("store_id", "product_variant_id") DO UPDATE
SET
  "product_id" = EXCLUDED."product_id",
  "available_stock" = EXCLUDED."available_stock",
  "reserved_stock" = EXCLUDED."reserved_stock",
  "sold_stock" = EXCLUDED."sold_stock",
  "in_stock" = EXCLUDED."in_stock",
  "variant_status" = EXCLUDED."variant_status",
  "stock_version" = EXCLUDED."stock_version",
  "updated_at" = now();

CREATE INDEX IF NOT EXISTS "variant_inventory_summary_store_product_idx"
  ON "variant_inventory_summary"("store_id", "product_id");

CREATE INDEX IF NOT EXISTS "variant_inventory_summary_store_in_stock_idx"
  ON "variant_inventory_summary"("store_id", "in_stock");

CREATE INDEX IF NOT EXISTS "variant_inventory_summary_variant_idx"
  ON "variant_inventory_summary"("product_variant_id");

CREATE UNIQUE INDEX IF NOT EXISTS "variant_inventory_summary_product_variant_id_key"
  ON "variant_inventory_summary"("product_variant_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'variant_inventory_summary_product_variant_id_fkey'
  ) THEN
    ALTER TABLE "variant_inventory_summary"
      ADD CONSTRAINT "variant_inventory_summary_product_variant_id_fkey"
      FOREIGN KEY ("product_variant_id")
      REFERENCES "product_variants"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;
