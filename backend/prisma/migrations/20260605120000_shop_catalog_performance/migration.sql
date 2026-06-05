CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "stores"
ADD COLUMN IF NOT EXISTS "public_code" VARCHAR(6);

UPDATE "stores"
SET "public_code" = lpad(
  ((
    (get_byte(digest("id"::text, 'sha256'), 0)::bigint << 40) +
    (get_byte(digest("id"::text, 'sha256'), 1)::bigint << 32) +
    (get_byte(digest("id"::text, 'sha256'), 2)::bigint << 24) +
    (get_byte(digest("id"::text, 'sha256'), 3)::bigint << 16) +
    (get_byte(digest("id"::text, 'sha256'), 4)::bigint << 8) +
    get_byte(digest("id"::text, 'sha256'), 5)::bigint
  ) % 1000000)::text,
  6,
  '0'
)
WHERE "public_code" IS NULL;

CREATE INDEX IF NOT EXISTS "stores_public_code_status_deleted_at_idx"
ON "stores"("public_code", "status", "deleted_at");

CREATE INDEX IF NOT EXISTS "products_store_status_active_created_at_idx"
ON "products"("store_id", "status", "is_active", "created_at");

CREATE INDEX IF NOT EXISTS "products_store_status_active_price_idx"
ON "products"("store_id", "status", "is_active", "price");

CREATE INDEX IF NOT EXISTS "products_store_status_active_updated_at_idx"
ON "products"("store_id", "status", "is_active", "updated_at");

CREATE INDEX IF NOT EXISTS "products_store_status_active_category_id_idx"
ON "products"("store_id", "status", "is_active", "category_id");

CREATE INDEX IF NOT EXISTS "products_store_status_active_sub_category_idx"
ON "products"("store_id", "status", "is_active", "sub_category");
