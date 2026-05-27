-- Add optimistic concurrency and explicit default variant metadata.
-- The audit table is intentionally persistent so a bad default-selection
-- backfill can be inspected and repaired without guessing.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "catalog_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "product_variants"
  ADD COLUMN IF NOT EXISTS "is_default" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "product_default_variant_migration_audit" (
  "product_id" UUID PRIMARY KEY,
  "chosen_variant_id" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

-- Deterministic backfill:
-- 1. Exact product/default shape match first.
-- 2. Otherwise the earliest variant for the product.
-- The CTE can be rerun safely; it only touches products without a default.
WITH ranked_variants AS (
  SELECT
    p.id AS product_id,
    pv.id AS variant_id,
    CASE
      WHEN
        COALESCE(p.sku, '') = COALESCE(pv.sku, '')
        AND p.price = pv.price
        AND COALESCE(p.compare_at_price, 0) = COALESCE(pv.mrp, 0)
        AND p.stock = pv.stock
        AND p.unit_group = pv.unit_group
        AND p.quantity_value = pv.quantity_value
        AND p.quantity_unit = pv.quantity_unit
        AND p.pack_type = pv.pack_type
      THEN 'exact_product_match'
      ELSE 'earliest_variant'
    END AS reason,
    ROW_NUMBER() OVER (
      PARTITION BY p.id
      ORDER BY
        CASE
          WHEN
            COALESCE(p.sku, '') = COALESCE(pv.sku, '')
            AND p.price = pv.price
            AND COALESCE(p.compare_at_price, 0) = COALESCE(pv.mrp, 0)
            AND p.stock = pv.stock
            AND p.unit_group = pv.unit_group
            AND p.quantity_value = pv.quantity_value
            AND p.quantity_unit = pv.quantity_unit
            AND p.pack_type = pv.pack_type
          THEN 0
          ELSE 1
        END,
        pv.created_at ASC,
        pv.id ASC
    ) AS rank
  FROM "products" p
  JOIN "product_variants" pv ON pv.product_id = p.id
  WHERE NOT EXISTS (
    SELECT 1
    FROM "product_variants" existing_default
    WHERE existing_default.product_id = p.id
      AND existing_default.is_default = true
  )
),
chosen AS (
  SELECT product_id, variant_id, reason
  FROM ranked_variants
  WHERE rank = 1
),
audit AS (
  INSERT INTO "product_default_variant_migration_audit" (
    "product_id",
    "chosen_variant_id",
    "reason"
  )
  SELECT product_id, variant_id, reason
  FROM chosen
  ON CONFLICT ("product_id") DO NOTHING
  RETURNING "product_id"
)
UPDATE "product_variants" pv
SET "is_default" = true,
    "position" = 0
FROM chosen
WHERE pv.id = chosen.variant_id;

WITH ordered_non_default AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY created_at ASC, id ASC) AS row_number
  FROM "product_variants"
  WHERE is_default = false
)
UPDATE "product_variants" pv
SET "position" = ordered_non_default.row_number
FROM ordered_non_default
WHERE pv.id = ordered_non_default.id
  AND pv.position = 0;

DO $$
DECLARE
  missing_defaults integer;
  duplicate_defaults integer;
BEGIN
  SELECT COUNT(*) INTO missing_defaults
  FROM "products" p
  WHERE EXISTS (
    SELECT 1 FROM "product_variants" pv WHERE pv.product_id = p.id
  )
    AND NOT EXISTS (
      SELECT 1
      FROM "product_variants" pv
      WHERE pv.product_id = p.id
        AND pv.is_default = true
    );

  SELECT COUNT(*) INTO duplicate_defaults
  FROM (
    SELECT product_id
    FROM "product_variants"
    WHERE is_default = true
    GROUP BY product_id
    HAVING COUNT(*) > 1
  ) duplicates;

  IF missing_defaults > 0 THEN
    RAISE EXCEPTION 'Default variant backfill failed: % products have variants but no default', missing_defaults;
  END IF;

  IF duplicate_defaults > 0 THEN
    RAISE EXCEPTION 'Default variant backfill failed: % products have duplicate defaults', duplicate_defaults;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_one_default_per_product_idx"
  ON "product_variants"("product_id")
  WHERE "is_default" = true;

CREATE INDEX IF NOT EXISTS "product_variants_product_default_position_idx"
  ON "product_variants"("product_id", "is_default", "position");
