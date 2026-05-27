CREATE TYPE "UploadPurpose" AS ENUM (
  'PRODUCT_IMAGE',
  'STORE_LOGO',
  'STORE_BANNER',
  'CATEGORY_IMAGE',
  'USER_AVATAR'
);

CREATE TYPE "UploadAssetStatus" AS ENUM (
  'TEMP',
  'READY',
  'ATTACHED',
  'ORPHANED',
  'REJECTED'
);

CREATE TYPE "UploadProvider" AS ENUM (
  'CLOUDINARY'
);

CREATE TYPE "UploadRenditionKind" AS ENUM (
  'THUMBNAIL',
  'CARD',
  'DETAIL',
  'ZOOM',
  'JPEG_FALLBACK'
);

CREATE TYPE "IdempotencyStatus" AS ENUM (
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED'
);

CREATE TYPE "ProductStatus" AS ENUM (
  'DRAFT',
  'PUBLISHED',
  'PAUSED',
  'NEEDS_REVIEW'
);

ALTER TABLE "products"
  ADD COLUMN "sku" TEXT,
  ADD COLUMN "seo_title" TEXT,
  ADD COLUMN "seo_description" TEXT,
  ADD COLUMN "compare_at_price" DECIMAL(10,2),
  ADD COLUMN "reorder_point" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT';

CREATE TABLE "upload_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "store_id" UUID,
  "uploaded_by_user_id" UUID NOT NULL,
  "purpose" "UploadPurpose" NOT NULL,
  "status" "UploadAssetStatus" NOT NULL DEFAULT 'TEMP',
  "source_sha256" VARCHAR(64) NOT NULL,
  "original_filename" TEXT NOT NULL,
  "draft_id" VARCHAR(120),
  "client_file_id" VARCHAR(120),
  "mime_type" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "bytes" INTEGER NOT NULL,
  "failure_reason" TEXT,
  "expires_at" TIMESTAMPTZ(3),
  "attached_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "upload_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "upload_assets_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "upload_assets_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "upload_asset_renditions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "upload_asset_id" UUID NOT NULL,
  "kind" "UploadRenditionKind" NOT NULL,
  "provider" "UploadProvider" NOT NULL DEFAULT 'CLOUDINARY',
  "provider_public_id" TEXT NOT NULL,
  "secure_url" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "bytes" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "upload_asset_renditions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "upload_asset_renditions_upload_asset_id_fkey" FOREIGN KEY ("upload_asset_id") REFERENCES "upload_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "idempotency_keys" (
  "key" TEXT NOT NULL,
  "store_id" UUID,
  "user_id" UUID NOT NULL,
  "operation" TEXT NOT NULL,
  "request_hash" VARCHAR(64) NOT NULL,
  "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "response_json" JSONB,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "idempotency_keys_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "product_variants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "price" DECIMAL(10,2) NOT NULL,
  "stock" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "product_images" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_id" UUID NOT NULL,
  "upload_asset_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "alt_text" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "product_images_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_images_upload_asset_id_fkey" FOREIGN KEY ("upload_asset_id") REFERENCES "upload_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "product_image_variants" (
  "product_image_id" UUID NOT NULL,
  "product_variant_id" UUID NOT NULL,

  CONSTRAINT "product_image_variants_pkey" PRIMARY KEY ("product_image_id", "product_variant_id"),
  CONSTRAINT "product_image_variants_product_image_id_fkey" FOREIGN KEY ("product_image_id") REFERENCES "product_images"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_image_variants_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "products_store_id_sku_key" ON "products"("store_id", "sku");
CREATE INDEX "products_store_id_status_updated_at_idx" ON "products"("store_id", "status", "updated_at");

CREATE INDEX "upload_assets_store_id_purpose_source_sha256_idx" ON "upload_assets"("store_id", "purpose", "source_sha256");
CREATE INDEX "upload_assets_store_id_purpose_draft_id_source_sha256_idx" ON "upload_assets"("store_id", "purpose", "draft_id", "source_sha256");
CREATE INDEX "upload_assets_store_id_purpose_status_idx" ON "upload_assets"("store_id", "purpose", "status");
CREATE INDEX "upload_assets_status_expires_at_idx" ON "upload_assets"("status", "expires_at");
CREATE INDEX "upload_assets_uploaded_by_user_id_created_at_idx" ON "upload_assets"("uploaded_by_user_id", "created_at");

CREATE UNIQUE INDEX "upload_asset_renditions_provider_provider_public_id_key" ON "upload_asset_renditions"("provider", "provider_public_id");
CREATE UNIQUE INDEX "upload_asset_renditions_upload_asset_id_kind_key" ON "upload_asset_renditions"("upload_asset_id", "kind");
CREATE INDEX "upload_asset_renditions_upload_asset_id_idx" ON "upload_asset_renditions"("upload_asset_id");

CREATE INDEX "idempotency_keys_store_id_operation_expires_at_idx" ON "idempotency_keys"("store_id", "operation", "expires_at");
CREATE INDEX "idempotency_keys_user_id_operation_expires_at_idx" ON "idempotency_keys"("user_id", "operation", "expires_at");

CREATE UNIQUE INDEX "product_images_upload_asset_id_key" ON "product_images"("upload_asset_id");
CREATE INDEX "product_images_product_id_sort_order_idx" ON "product_images"("product_id", "sort_order");
CREATE INDEX "product_images_product_id_is_primary_idx" ON "product_images"("product_id", "is_primary");

CREATE UNIQUE INDEX "product_variants_product_id_sku_key" ON "product_variants"("product_id", "sku");
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");
