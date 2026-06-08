CREATE EXTENSION IF NOT EXISTS "postgis";

ALTER TABLE "stores"
  ADD COLUMN IF NOT EXISTS "delivery_radius_km" NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS "inactive" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_closed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "is_banned" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "out_of_service" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "merchant_rating" NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS "order_volume_score" NUMERIC(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "conversion_score" NUMERIC(5, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stores_delivery_radius_km_chk'
  ) THEN
    ALTER TABLE "stores"
      ADD CONSTRAINT "stores_delivery_radius_km_chk"
      CHECK ("delivery_radius_km" IS NULL OR "delivery_radius_km" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stores_merchant_rating_chk'
  ) THEN
    ALTER TABLE "stores"
      ADD CONSTRAINT "stores_merchant_rating_chk"
      CHECK ("merchant_rating" IS NULL OR ("merchant_rating" >= 0 AND "merchant_rating" <= 5));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stores_order_volume_score_chk'
  ) THEN
    ALTER TABLE "stores"
      ADD CONSTRAINT "stores_order_volume_score_chk"
      CHECK ("order_volume_score" >= 0 AND "order_volume_score" <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stores_conversion_score_chk'
  ) THEN
    ALTER TABLE "stores"
      ADD CONSTRAINT "stores_conversion_score_chk"
      CHECK ("conversion_score" >= 0 AND "conversion_score" <= 100);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_merchants_geo"
  ON "stores" USING GIST ("location")
  WHERE "status" = 'APPROVED'
    AND "deleted_at" IS NULL
    AND "inactive" = false
    AND "is_closed" = false
    AND "is_banned" = false
    AND "out_of_service" = false
    AND "location" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "stores_geo_eligibility_idx"
  ON "stores" ("status", "deleted_at", "inactive", "is_closed", "is_banned", "out_of_service", "updated_at", "id");

ALTER TABLE "shop_discovery_cards"
  ADD COLUMN IF NOT EXISTS "delivery_radius_km" NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS "merchant_rating" NUMERIC(3, 2),
  ADD COLUMN IF NOT EXISTS "order_volume_score" NUMERIC(5, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "conversion_score" NUMERIC(5, 2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "idx_shop_discovery_cards_geo"
  ON "shop_discovery_cards" USING GIST ("location")
  WHERE "location" IS NOT NULL;

CREATE OR REPLACE FUNCTION "refresh_shop_discovery_card"("target_store_id" UUID)
RETURNS VOID AS $$
BEGIN
  WITH "source" AS (
    SELECT
      s."id" AS "store_id",
      s."public_code",
      "shop_discovery_slug"(s."name") AS "public_slug",
      s."name",
      s."slug"::TEXT AS "slug",
      coalesce(nullif(regexp_replace(lower(coalesce(bp."category", 'grocery')), '[\s_]+', '-', 'g'), ''), 'grocery') AS "type",
      s."latitude" AS "lat",
      s."longitude" AS "lng",
      s."location",
      s."delivery_radius_km",
      s."merchant_rating",
      s."order_volume_score",
      s."conversion_score",
      CASE WHEN s."is_delivery_available" THEN '10-20 min' ELSE 'Self Pickup' END AS "delivery_time",
      CASE WHEN s."is_delivery_available" THEN 'Free' ELSE 'No delivery' END AS "delivery_fee",
      s."image_url",
      logo."url" AS "logo_url",
      banner."url" AS "banner_url",
      coalesce(featured."name", 'Daily Essentials') AS "featured_product",
      jsonb_strip_nulls(jsonb_build_object(
        'tagline', b."tagline",
        'description', b."description",
        'primaryColor', b."primary_color",
        'accentColor', b."accent_color"
      )) AS "branding_json",
      ss."business_hours"::jsonb AS "business_hours_json",
      greatest(
        s."updated_at",
        coalesce(bp."updated_at", s."updated_at"),
        coalesce(b."updated_at", s."updated_at"),
        coalesce(ss."updated_at", s."updated_at"),
        coalesce(featured."updated_at", s."updated_at"),
        coalesce(logo."updated_at", s."updated_at"),
        coalesce(banner."updated_at", s."updated_at")
      ) AS "updated_at"
    FROM "stores" s
    LEFT JOIN "store_business_profiles" bp ON bp."store_id" = s."id"
    LEFT JOIN "store_branding" b ON b."store_id" = s."id"
    LEFT JOIN "store_media" logo ON logo."id" = b."logo_media_id"
    LEFT JOIN "store_media" banner ON banner."id" = b."banner_media_id"
    LEFT JOIN "store_settings" ss ON ss."store_id" = s."id"
    LEFT JOIN LATERAL (
      SELECT p."name", p."updated_at"
      FROM "products" p
      WHERE p."store_id" = s."id"
        AND p."is_active" = true
        AND p."status" = 'PUBLISHED'::"ProductStatus"
      ORDER BY p."updated_at" DESC, p."id" ASC
      LIMIT 1
    ) featured ON true
    WHERE s."id" = "target_store_id"
      AND s."status" = 'APPROVED'::"StoreStatus"
      AND s."deleted_at" IS NULL
      AND s."inactive" = false
      AND s."is_closed" = false
      AND s."is_banned" = false
      AND s."out_of_service" = false
      AND s."location" IS NOT NULL
  )
  INSERT INTO "shop_discovery_cards" (
    "store_id",
    "public_code",
    "public_slug",
    "name",
    "slug",
    "type",
    "type_name",
    "lat",
    "lng",
    "location",
    "delivery_radius_km",
    "merchant_rating",
    "order_volume_score",
    "conversion_score",
    "delivery_time",
    "delivery_fee",
    "image_url",
    "logo_url",
    "banner_url",
    "featured_product",
    "branding_json",
    "business_hours_json",
    "updated_at"
  )
  SELECT
    "store_id",
    "public_code",
    "public_slug",
    "name",
    "slug",
    "type",
    "shop_discovery_type_name"("type"),
    "lat",
    "lng",
    "location",
    "delivery_radius_km",
    "merchant_rating",
    "order_volume_score",
    "conversion_score",
    "delivery_time",
    "delivery_fee",
    "image_url",
    "logo_url",
    "banner_url",
    "featured_product",
    "branding_json",
    "business_hours_json",
    "updated_at"
  FROM "source"
  ON CONFLICT ("store_id") DO UPDATE SET
    "public_code" = EXCLUDED."public_code",
    "public_slug" = EXCLUDED."public_slug",
    "name" = EXCLUDED."name",
    "slug" = EXCLUDED."slug",
    "type" = EXCLUDED."type",
    "type_name" = EXCLUDED."type_name",
    "lat" = EXCLUDED."lat",
    "lng" = EXCLUDED."lng",
    "location" = EXCLUDED."location",
    "delivery_radius_km" = EXCLUDED."delivery_radius_km",
    "merchant_rating" = EXCLUDED."merchant_rating",
    "order_volume_score" = EXCLUDED."order_volume_score",
    "conversion_score" = EXCLUDED."conversion_score",
    "delivery_time" = EXCLUDED."delivery_time",
    "delivery_fee" = EXCLUDED."delivery_fee",
    "image_url" = EXCLUDED."image_url",
    "logo_url" = EXCLUDED."logo_url",
    "banner_url" = EXCLUDED."banner_url",
    "featured_product" = EXCLUDED."featured_product",
    "branding_json" = EXCLUDED."branding_json",
    "business_hours_json" = EXCLUDED."business_hours_json",
    "updated_at" = EXCLUDED."updated_at";

  IF NOT FOUND THEN
    DELETE FROM "shop_discovery_cards" WHERE "store_id" = "target_store_id";
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "shop_discovery_cards_store_trg" ON "stores";
CREATE TRIGGER "shop_discovery_cards_store_trg"
AFTER INSERT OR UPDATE OF "name", "public_code", "slug", "latitude", "longitude", "location", "status", "deleted_at", "inactive", "is_closed", "is_banned", "out_of_service", "delivery_radius_km", "merchant_rating", "order_volume_score", "conversion_score", "is_delivery_available", "image_url", "updated_at" OR DELETE ON "stores"
FOR EACH ROW
EXECUTE FUNCTION "refresh_shop_discovery_card_from_store"();

UPDATE "shop_discovery_cards" c
SET
  "delivery_radius_km" = s."delivery_radius_km",
  "merchant_rating" = s."merchant_rating",
  "order_volume_score" = s."order_volume_score",
  "conversion_score" = s."conversion_score"
FROM "stores" s
WHERE c."store_id" = s."id";

DELETE FROM "shop_discovery_cards" c
USING "stores" s
WHERE c."store_id" = s."id"
  AND (
    s."status" <> 'APPROVED'::"StoreStatus"
    OR s."deleted_at" IS NOT NULL
    OR s."inactive" = true
    OR s."is_closed" = true
    OR s."is_banned" = true
    OR s."out_of_service" = true
    OR s."location" IS NULL
  );
