-- Defensive repair migration for environments where the product taxonomy
-- Prisma fields shipped before the physical products table was updated.
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "sub_category" TEXT,
  ADD COLUMN IF NOT EXISTS "product_type" TEXT;
