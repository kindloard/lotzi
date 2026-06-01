CREATE INDEX IF NOT EXISTS "inventory_ledger_idempotency_key_idx"
  ON "inventory_ledger"("idempotency_key");
