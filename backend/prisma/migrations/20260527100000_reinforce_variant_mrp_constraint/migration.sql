-- Migration: Reinforce product_variants_price_valid constraint
-- Root cause: The original constraint allowed mrp = 0, which violates
-- business semantics (MRP is always a positive price, never zero).
-- The backend now normalises 0 → NULL before writes, but this migration
-- also makes the DB constraint self-documenting and an additional safety net.

DO $$
BEGIN
  -- Drop the original constraint that allowed mrp = 0
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_price_valid') THEN
    ALTER TABLE "product_variants" DROP CONSTRAINT "product_variants_price_valid";
  END IF;

  -- Reinstate with explicit mrp > 0 guard so mrp = 0 is definitively invalid
  -- Valid states:
  --   mrp IS NULL                 → no MRP set, allowed
  --   mrp > 0 AND mrp >= price    → valid MRP above or equal to selling price
  -- Invalid states:
  --   mrp = 0                     → sentinel "not set" value leaked as 0, rejected
  --   mrp > 0 AND mrp < price     → MRP below selling price, rejected
  ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_price_valid"
    CHECK (
      "price" >= 0
      AND ("mrp" IS NULL OR ("mrp" > 0 AND "mrp" >= "price"))
      AND ("cost_price" IS NULL OR "cost_price" >= 0)
    );
END $$;
