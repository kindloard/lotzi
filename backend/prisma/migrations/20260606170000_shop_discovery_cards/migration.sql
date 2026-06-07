CREATE EXTENSION IF NOT EXISTS "postgis";

CREATE TABLE IF NOT EXISTS "shop_discovery_cards" (
  "store_id" UUID PRIMARY KEY REFERENCES "stores"("id") ON DELETE CASCADE,
  "public_code" VARCHAR(6),
  "public_slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "type_name" TEXT NOT NULL,
  "lat" NUMERIC(10, 7),
  "lng" NUMERIC(10, 7),
  "location" geography(Point,4326),
  "delivery_time" TEXT NOT NULL,
  "delivery_fee" TEXT NOT NULL,
  "image_url" TEXT,
  "logo_url" TEXT,
  "banner_url" TEXT,
  "featured_product" TEXT NOT NULL,
  "branding_json" JSONB,
  "business_hours_json" JSONB,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "shop_discovery_cards_location_gist_idx"
  ON "shop_discovery_cards" USING GIST ("location")
  WHERE "location" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "shop_discovery_cards_updated_store_idx"
  ON "shop_discovery_cards" ("updated_at" DESC, "store_id");

CREATE OR REPLACE FUNCTION "shop_discovery_slug"("value" TEXT)
RETURNS TEXT AS $$
DECLARE
  "normalized" TEXT;
BEGIN
  "normalized" := lower(trim(coalesce("value", '')));
  "normalized" := regexp_replace("normalized", '[^a-z0-9]+', '-', 'g');
  "normalized" := regexp_replace("normalized", '(^-+|-+$)', '', 'g');
  "normalized" := left("normalized", 96);
  RETURN coalesce(nullif("normalized", ''), 'store');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION "shop_discovery_type_name"("value" TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN initcap(replace(coalesce(nullif("value", ''), 'grocery'), '-', ' '));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

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

CREATE OR REPLACE FUNCTION "refresh_shop_discovery_card_from_store"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "shop_discovery_cards" WHERE "store_id" = OLD."id";
    RETURN OLD;
  END IF;
  PERFORM "refresh_shop_discovery_card"(NEW."id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "refresh_shop_discovery_card_from_store_child"()
RETURNS trigger AS $$
DECLARE
  "target_store_id" UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    "target_store_id" := OLD."store_id";
  ELSE
    "target_store_id" := NEW."store_id";
  END IF;
  IF "target_store_id" IS NOT NULL THEN
    PERFORM "refresh_shop_discovery_card"("target_store_id");
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "refresh_shop_discovery_card_from_media"()
RETURNS trigger AS $$
DECLARE
  "media_id" UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    "media_id" := OLD."id";
  ELSE
    "media_id" := NEW."id";
  END IF;
  PERFORM "refresh_shop_discovery_card"(b."store_id")
  FROM "store_branding" b
  WHERE b."logo_media_id" = "media_id"
     OR b."banner_media_id" = "media_id";
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "shop_discovery_cards_store_trg" ON "stores";
CREATE TRIGGER "shop_discovery_cards_store_trg"
AFTER INSERT OR UPDATE OF "name", "public_code", "slug", "latitude", "longitude", "location", "status", "deleted_at", "is_delivery_available", "image_url", "updated_at" OR DELETE ON "stores"
FOR EACH ROW
EXECUTE FUNCTION "refresh_shop_discovery_card_from_store"();

DROP TRIGGER IF EXISTS "shop_discovery_cards_business_profile_trg" ON "store_business_profiles";
CREATE TRIGGER "shop_discovery_cards_business_profile_trg"
AFTER INSERT OR UPDATE OR DELETE ON "store_business_profiles"
FOR EACH ROW
EXECUTE FUNCTION "refresh_shop_discovery_card_from_store_child"();

DROP TRIGGER IF EXISTS "shop_discovery_cards_branding_trg" ON "store_branding";
CREATE TRIGGER "shop_discovery_cards_branding_trg"
AFTER INSERT OR UPDATE OR DELETE ON "store_branding"
FOR EACH ROW
EXECUTE FUNCTION "refresh_shop_discovery_card_from_store_child"();

DROP TRIGGER IF EXISTS "shop_discovery_cards_settings_trg" ON "store_settings";
CREATE TRIGGER "shop_discovery_cards_settings_trg"
AFTER INSERT OR UPDATE OR DELETE ON "store_settings"
FOR EACH ROW
EXECUTE FUNCTION "refresh_shop_discovery_card_from_store_child"();

DROP TRIGGER IF EXISTS "shop_discovery_cards_products_trg" ON "products";
CREATE TRIGGER "shop_discovery_cards_products_trg"
AFTER INSERT OR UPDATE OF "name", "store_id", "status", "is_active", "updated_at" OR DELETE ON "products"
FOR EACH ROW
EXECUTE FUNCTION "refresh_shop_discovery_card_from_store_child"();

DROP TRIGGER IF EXISTS "shop_discovery_cards_media_trg" ON "store_media";
CREATE TRIGGER "shop_discovery_cards_media_trg"
AFTER UPDATE OF "url", "updated_at" OR DELETE ON "store_media"
FOR EACH ROW
EXECUTE FUNCTION "refresh_shop_discovery_card_from_media"();

INSERT INTO "shop_discovery_cards" ("store_id", "public_code", "public_slug", "name", "slug", "type", "type_name", "lat", "lng", "location", "delivery_time", "delivery_fee", "image_url", "logo_url", "banner_url", "featured_product", "branding_json", "business_hours_json", "updated_at")
SELECT
  s."id",
  s."public_code",
  "shop_discovery_slug"(s."name"),
  s."name",
  s."slug"::TEXT,
  coalesce(nullif(regexp_replace(lower(coalesce(bp."category", 'grocery')), '[\s_]+', '-', 'g'), ''), 'grocery') AS "type",
  "shop_discovery_type_name"(coalesce(nullif(regexp_replace(lower(coalesce(bp."category", 'grocery')), '[\s_]+', '-', 'g'), ''), 'grocery')),
  s."latitude",
  s."longitude",
  s."location",
  CASE WHEN s."is_delivery_available" THEN '10-20 min' ELSE 'Self Pickup' END,
  CASE WHEN s."is_delivery_available" THEN 'Free' ELSE 'No delivery' END,
  s."image_url",
  logo."url",
  banner."url",
  coalesce(featured."name", 'Daily Essentials'),
  jsonb_strip_nulls(jsonb_build_object(
    'tagline', b."tagline",
    'description', b."description",
    'primaryColor', b."primary_color",
    'accentColor', b."accent_color"
  )),
  ss."business_hours"::jsonb,
  greatest(
    s."updated_at",
    coalesce(bp."updated_at", s."updated_at"),
    coalesce(b."updated_at", s."updated_at"),
    coalesce(ss."updated_at", s."updated_at"),
    coalesce(featured."updated_at", s."updated_at"),
    coalesce(logo."updated_at", s."updated_at"),
    coalesce(banner."updated_at", s."updated_at")
  )
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
WHERE s."status" = 'APPROVED'::"StoreStatus"
  AND s."deleted_at" IS NULL
  AND s."location" IS NOT NULL
ON CONFLICT ("store_id") DO NOTHING;
