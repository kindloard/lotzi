CREATE EXTENSION IF NOT EXISTS "postgis";

ALTER TABLE "stores"
  ADD COLUMN IF NOT EXISTS "location" geography(Point,4326);

ALTER TABLE "stores"
  ADD CONSTRAINT "stores_latitude_range_chk"
  CHECK ("latitude" IS NULL OR ("latitude" >= -90 AND "latitude" <= 90));

ALTER TABLE "stores"
  ADD CONSTRAINT "stores_longitude_range_chk"
  CHECK ("longitude" IS NULL OR ("longitude" >= -180 AND "longitude" <= 180));

ALTER TABLE "stores"
  ADD CONSTRAINT "stores_coordinate_pair_chk"
  CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL)
    OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION "stores_sync_location_from_coordinates"()
RETURNS trigger AS $$
BEGIN
  IF NEW."latitude" IS NULL OR NEW."longitude" IS NULL THEN
    NEW."location" := NULL;
  ELSE
    NEW."location" := ST_SetSRID(
      ST_MakePoint(NEW."longitude"::double precision, NEW."latitude"::double precision),
      4326
    )::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "stores_sync_location_from_coordinates_trg" ON "stores";
CREATE TRIGGER "stores_sync_location_from_coordinates_trg"
BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "stores"
FOR EACH ROW
EXECUTE FUNCTION "stores_sync_location_from_coordinates"();

UPDATE "stores"
SET "location" = ST_SetSRID(
  ST_MakePoint("longitude"::double precision, "latitude"::double precision),
  4326
)::geography
WHERE "latitude" IS NOT NULL
  AND "longitude" IS NOT NULL
  AND "location" IS NULL;

DO $$
DECLARE
  missing_location_after_backfill bigint;
BEGIN
  SELECT count(*)
  INTO missing_location_after_backfill
  FROM "stores"
  WHERE "latitude" IS NOT NULL
    AND "longitude" IS NOT NULL
    AND "location" IS NULL;

  IF missing_location_after_backfill <> 0 THEN
    RAISE EXCEPTION 'Geo discovery backfill validation failed: % stores still have coordinates without location.', missing_location_after_backfill;
  END IF;

  RAISE NOTICE 'Geo discovery backfill validation passed: missing_location_after_backfill=0';
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "stores_discovery_location_gist_idx"
  ON "stores" USING GIST ("location")
  WHERE "status" = 'APPROVED'
    AND "deleted_at" IS NULL
    AND "location" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "stores_discovery_status_updated_idx"
  ON "stores" ("status", "deleted_at", "updated_at", "id");
