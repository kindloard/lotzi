ALTER TYPE "DomainEventStatus" ADD VALUE IF NOT EXISTS 'DEAD_LETTER';

CREATE INDEX IF NOT EXISTS "domain_events_catalog_outbox_idx"
  ON "domain_events"("status", "next_run_at", "created_at")
  WHERE "event_type" LIKE 'catalog.%' OR "event_type" LIKE 'inventory.%';
