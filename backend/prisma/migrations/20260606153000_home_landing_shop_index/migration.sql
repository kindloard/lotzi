CREATE INDEX CONCURRENTLY IF NOT EXISTS "stores_landing_approved_order_idx"
  ON "stores" ("approved_at" DESC, "updated_at" DESC, "id")
  WHERE "status" = 'APPROVED'
    AND "deleted_at" IS NULL;
