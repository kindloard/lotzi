import type { PrismaClient } from "@prisma/client";

export interface SchemaIssue {
  kind: "table" | "column" | "enum" | "index" | "constraint";
  name: string;
  details?: string;
}

export interface ProductCatalogSchemaReport {
  ok: boolean;
  missing: SchemaIssue[];
  counts?: {
    productsWithoutVariants: number;
    cartItemsWithoutVariants: number;
    invalidVariantMeasurements: number;
    negativeStockRows: number;
  };
}

const requiredTables = [
  "products",
  "product_variants",
  "product_images",
  "product_image_variants",
  "upload_assets",
  "upload_asset_renditions",
  "cart_items",
  "order_items",
  "stock_reservations"
] as const;

const requiredColumns: Record<string, string[]> = {
  products: [
    "unit_group",
    "quantity_value",
    "quantity_unit",
    "normalized_value",
    "normalized_unit",
    "pack_type",
    "price_per_base_unit",
    "sub_category",
    "product_type",
    "sku",
    "status"
  ],
  product_variants: [
    "mrp",
    "cost_price",
    "price_per_base_unit",
    "stock_on_hand",
    "stock_reserved",
    "stock_version",
    "unit_group",
    "quantity_value",
    "quantity_unit",
    "normalized_value",
    "normalized_unit",
    "pack_type"
  ],
  cart_items: ["variant_id"],
  order_items: ["variant_id", "variant_name", "unit_display", "quantity_value", "quantity_unit", "pack_type", "mrp"],
  upload_assets: [
    "original_provider_public_id",
    "original_secure_url",
    "cleanup_attempted_at",
    "cleanup_succeeded_at",
    "cleanup_attempt_count",
    "cleanup_last_error"
  ],
  upload_asset_renditions: ["transformation"]
};

const requiredEnums: Record<string, string[]> = {
  UnitGroup: ["WEIGHT", "VOLUME", "COUNT", "LENGTH", "AREA", "BUNDLE"],
  MeasurementUnit: ["MG", "G", "KG", "TONNE", "ML", "LITRE", "GALLON", "PIECE", "PAIR", "DOZEN", "CM", "METER", "INCH", "FEET", "SQ_FT", "SQ_METER"],
  PackType: ["UNIT", "PACK", "PACKET", "BOX", "CARTON", "BOTTLE", "POUCH", "JAR", "CAN", "SACHET", "STRIP", "BAG", "TRAY", "BUNCH", "BUNDLE", "SET"],
  StockReservationStatus: ["ACTIVE", "RELEASED", "FINALIZED", "EXPIRED"]
};

const requiredIndexes = [
  "products_unit_group_quantity_unit_idx",
  "product_variants_unit_group_quantity_unit_idx",
  "product_variants_stock_on_hand_stock_reserved_idx",
  "cart_items_variant_id_idx",
  "order_items_variant_id_idx",
  "stock_reservations_product_variant_id_status_idx",
  "stock_reservations_status_expires_at_idx",
  "stock_reservations_user_id_status_idx"
] as const;

const requiredConstraints = [
  "product_variants_stock_non_negative",
  "product_variants_quantity_positive",
  "product_variants_price_valid",
  "products_measurement_quantity_positive",
  "stock_reservations_quantity_positive",
  "stock_reservations_user_id_fkey",
  "stock_reservations_product_variant_id_fkey"
] as const;

interface ColumnRow {
  table_name: string;
  column_name: string;
  is_nullable: "YES" | "NO";
}

interface EnumRow {
  enum_name: string;
  values: string[];
}

interface NameRow {
  name: string;
}

interface CountRow {
  products_without_variants: number;
  cart_items_without_variants: number;
  invalid_variant_measurements: number;
  negative_stock_rows: number;
}

export async function verifyProductCatalogSchema(prisma: PrismaClient): Promise<ProductCatalogSchemaReport> {
  const [tables, columns, enums, indexes, constraints] = await Promise.all([
    prisma.$queryRawUnsafe<NameRow[]>(`
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (${sqlStringList(requiredTables)})
    `),
    prisma.$queryRawUnsafe<ColumnRow[]>(`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN (${sqlStringList(Object.keys(requiredColumns))})
    `),
    prisma.$queryRawUnsafe<EnumRow[]>(`
      SELECT t.typname AS enum_name, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN (${sqlStringList(Object.keys(requiredEnums))})
      GROUP BY t.typname
    `),
    prisma.$queryRawUnsafe<NameRow[]>(`
      SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (${sqlStringList(requiredIndexes)})
    `),
    prisma.$queryRawUnsafe<NameRow[]>(`
      SELECT conname AS name
      FROM pg_constraint
      WHERE conname IN (${sqlStringList(requiredConstraints)})
    `)
  ]);

  const missing: SchemaIssue[] = [];
  const existingTables = new Set(tables.map((row) => row.name));
  const existingColumns = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
  const enumValues = new Map(enums.map((row) => [row.enum_name, new Set(row.values)]));
  const existingIndexes = new Set(indexes.map((row) => row.name));
  const existingConstraints = new Set(constraints.map((row) => row.name));

  for (const table of requiredTables) {
    if (!existingTables.has(table)) {
      missing.push({ kind: "table", name: table });
    }
  }

  for (const [table, tableColumns] of Object.entries(requiredColumns)) {
    for (const column of tableColumns) {
      if (!existingColumns.has(`${table}.${column}`)) {
        missing.push({ kind: "column", name: `${table}.${column}` });
      }
    }
  }

  const variantSku = columns.find((row) => row.table_name === "product_variants" && row.column_name === "sku");
  if (variantSku && variantSku.is_nullable !== "YES") {
    missing.push({ kind: "column", name: "product_variants.sku", details: "Column must be nullable." });
  }

  for (const [enumName, values] of Object.entries(requiredEnums)) {
    const existing = enumValues.get(enumName);
    if (!existing) {
      missing.push({ kind: "enum", name: enumName });
      continue;
    }
    for (const value of values) {
      if (!existing.has(value)) {
        missing.push({ kind: "enum", name: `${enumName}.${value}` });
      }
    }
  }

  for (const index of requiredIndexes) {
    if (!existingIndexes.has(index)) {
      missing.push({ kind: "index", name: index });
    }
  }

  for (const constraint of requiredConstraints) {
    if (!existingConstraints.has(constraint)) {
      missing.push({ kind: "constraint", name: constraint });
    }
  }

  const report: ProductCatalogSchemaReport = { ok: missing.length === 0, missing };
  if (report.ok) {
    const [counts] = await prisma.$queryRawUnsafe<CountRow[]>(`
      SELECT
        (
          SELECT count(*)::int
          FROM products p
          WHERE NOT EXISTS (
            SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id
          )
        ) AS products_without_variants,
        (
          SELECT count(*)::int
          FROM cart_items
          WHERE variant_id IS NULL
        ) AS cart_items_without_variants,
        (
          SELECT count(*)::int
          FROM product_variants
          WHERE quantity_value <= 0 OR normalized_value <= 0
        ) AS invalid_variant_measurements,
        (
          SELECT count(*)::int
          FROM product_variants
          WHERE stock < 0 OR stock_on_hand < 0 OR stock_reserved < 0
        ) AS negative_stock_rows
    `);

    report.counts = {
      productsWithoutVariants: counts?.products_without_variants ?? 0,
      cartItemsWithoutVariants: counts?.cart_items_without_variants ?? 0,
      invalidVariantMeasurements: counts?.invalid_variant_measurements ?? 0,
      negativeStockRows: counts?.negative_stock_rows ?? 0
    };
    report.ok = Object.values(report.counts).every((count) => count === 0);
  }

  return report;
}

export async function repairProductCatalogSchema(prisma: PrismaClient): Promise<void> {
  for (const statement of repairStatements) {
    await prisma.$executeRawUnsafe(statement);
  }
}

function sqlStringList(values: readonly string[]) {
  return values.map((value) => `'${value.replace(/'/g, "''")}'`).join(", ");
}

const repairStatements = [
  `DO $$
   BEGIN
     CREATE TYPE "UnitGroup" AS ENUM ('WEIGHT', 'VOLUME', 'COUNT', 'LENGTH', 'AREA', 'BUNDLE');
   EXCEPTION
     WHEN duplicate_object THEN NULL;
   END $$`,
  `DO $$
   BEGIN
     CREATE TYPE "MeasurementUnit" AS ENUM (
       'MG', 'G', 'KG', 'TONNE', 'ML', 'LITRE', 'GALLON', 'PIECE', 'PAIR', 'DOZEN',
       'CM', 'METER', 'INCH', 'FEET', 'SQ_FT', 'SQ_METER'
     );
   EXCEPTION
     WHEN duplicate_object THEN NULL;
   END $$`,
  `DO $$
   BEGIN
     CREATE TYPE "PackType" AS ENUM (
       'UNIT', 'PACK', 'PACKET', 'BOX', 'CARTON', 'BOTTLE', 'POUCH', 'JAR', 'CAN',
       'SACHET', 'STRIP', 'BAG', 'TRAY', 'BUNCH', 'BUNDLE', 'SET'
     );
   EXCEPTION
     WHEN duplicate_object THEN NULL;
   END $$`,
  `DO $$
   BEGIN
     CREATE TYPE "StockReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'FINALIZED', 'EXPIRED');
   EXCEPTION
     WHEN duplicate_object THEN NULL;
   END $$`,
  `ALTER TYPE "PackType" ADD VALUE IF NOT EXISTS 'PACKET'`,
  `ALTER TABLE "products"
     ADD COLUMN IF NOT EXISTS "unit_group" "UnitGroup" NOT NULL DEFAULT 'COUNT',
     ADD COLUMN IF NOT EXISTS "quantity_value" DECIMAL(12,4) NOT NULL DEFAULT 1,
     ADD COLUMN IF NOT EXISTS "quantity_unit" "MeasurementUnit" NOT NULL DEFAULT 'PIECE',
     ADD COLUMN IF NOT EXISTS "normalized_value" DECIMAL(14,4) NOT NULL DEFAULT 1,
     ADD COLUMN IF NOT EXISTS "normalized_unit" "MeasurementUnit" NOT NULL DEFAULT 'PIECE',
     ADD COLUMN IF NOT EXISTS "pack_type" "PackType" NOT NULL DEFAULT 'UNIT',
     ADD COLUMN IF NOT EXISTS "price_per_base_unit" DECIMAL(12,2) NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS "sub_category" TEXT,
     ADD COLUMN IF NOT EXISTS "product_type" TEXT`,
  `ALTER TABLE "product_variants"
     ADD COLUMN IF NOT EXISTS "mrp" DECIMAL(10,2),
     ADD COLUMN IF NOT EXISTS "cost_price" DECIMAL(10,2),
     ADD COLUMN IF NOT EXISTS "price_per_base_unit" DECIMAL(12,2) NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS "stock_on_hand" INTEGER NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS "stock_reserved" INTEGER NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS "stock_version" INTEGER NOT NULL DEFAULT 1,
     ADD COLUMN IF NOT EXISTS "unit_group" "UnitGroup" NOT NULL DEFAULT 'COUNT',
     ADD COLUMN IF NOT EXISTS "quantity_value" DECIMAL(12,4) NOT NULL DEFAULT 1,
     ADD COLUMN IF NOT EXISTS "quantity_unit" "MeasurementUnit" NOT NULL DEFAULT 'PIECE',
     ADD COLUMN IF NOT EXISTS "normalized_value" DECIMAL(14,4) NOT NULL DEFAULT 1,
     ADD COLUMN IF NOT EXISTS "normalized_unit" "MeasurementUnit" NOT NULL DEFAULT 'PIECE',
     ADD COLUMN IF NOT EXISTS "pack_type" "PackType" NOT NULL DEFAULT 'UNIT'`,
  `ALTER TABLE "upload_assets"
     ADD COLUMN IF NOT EXISTS "original_provider_public_id" TEXT,
     ADD COLUMN IF NOT EXISTS "original_secure_url" TEXT,
     ADD COLUMN IF NOT EXISTS "cleanup_attempted_at" TIMESTAMPTZ(3),
     ADD COLUMN IF NOT EXISTS "cleanup_succeeded_at" TIMESTAMPTZ(3),
     ADD COLUMN IF NOT EXISTS "cleanup_attempt_count" INTEGER NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS "cleanup_last_error" TEXT`,
  `ALTER TABLE "upload_asset_renditions"
     ADD COLUMN IF NOT EXISTS "transformation" TEXT`,
  `ALTER TABLE "upload_asset_renditions"
     ALTER COLUMN "provider_public_id" DROP NOT NULL,
     ALTER COLUMN "bytes" DROP NOT NULL`,
  `DROP INDEX IF EXISTS "upload_asset_renditions_provider_provider_public_id_key"`,
  `CREATE INDEX IF NOT EXISTS "upload_assets_original_provider_public_id_idx" ON "upload_assets"("original_provider_public_id")`,
  `CREATE INDEX IF NOT EXISTS "upload_assets_cleanup_succeeded_at_cleanup_attempt_count_idx" ON "upload_assets"("cleanup_succeeded_at", "cleanup_attempt_count")`,
  `CREATE INDEX IF NOT EXISTS "upload_asset_renditions_provider_provider_public_id_idx" ON "upload_asset_renditions"("provider", "provider_public_id")`,
  `ALTER TABLE "product_variants" ALTER COLUMN "sku" DROP NOT NULL`,
  `UPDATE "product_variants"
   SET "stock_on_hand" = "stock"
   WHERE "stock_on_hand" = 0 AND "stock" > 0`,
  `UPDATE "product_variants"
   SET "price_per_base_unit" = "price"
   WHERE "price_per_base_unit" = 0
     AND "unit_group" = 'COUNT'
     AND "quantity_value" = 1
     AND "quantity_unit" = 'PIECE'`,
  `UPDATE "products"
   SET "price_per_base_unit" = "price"
   WHERE "price_per_base_unit" = 0
     AND "unit_group" = 'COUNT'
     AND "quantity_value" = 1
     AND "quantity_unit" = 'PIECE'`,
  `INSERT INTO "product_variants" (
     "product_id", "name", "sku", "price", "mrp", "stock", "stock_on_hand", "unit_group",
     "quantity_value", "quantity_unit", "normalized_value", "normalized_unit", "pack_type",
     "price_per_base_unit", "created_at", "updated_at"
   )
   SELECT
     p."id", 'Default', p."sku", p."price", p."compare_at_price", p."stock", p."stock",
     'COUNT', 1, 'PIECE', 1, 'PIECE', 'UNIT',
     CASE WHEN p."price" IS NULL THEN 0 ELSE p."price" END,
     now(), now()
   FROM "products" p
   WHERE NOT EXISTS (
     SELECT 1 FROM "product_variants" pv WHERE pv."product_id" = p."id"
   )`,
  `ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "variant_id" UUID`,
  `ALTER TABLE "order_items"
     ADD COLUMN IF NOT EXISTS "variant_id" UUID,
     ADD COLUMN IF NOT EXISTS "variant_name" TEXT,
     ADD COLUMN IF NOT EXISTS "unit_display" TEXT,
     ADD COLUMN IF NOT EXISTS "quantity_value" DECIMAL(12,4),
     ADD COLUMN IF NOT EXISTS "quantity_unit" "MeasurementUnit",
     ADD COLUMN IF NOT EXISTS "pack_type" "PackType",
     ADD COLUMN IF NOT EXISTS "mrp" DECIMAL(10,2)`,
  `UPDATE "cart_items" ci
   SET "variant_id" = pv.id
   FROM "product_variants" pv
   WHERE ci."variant_id" IS NULL
     AND pv."product_id" = ci."product_id"
     AND pv.id = (
       SELECT pv2.id
       FROM "product_variants" pv2
       WHERE pv2."product_id" = ci."product_id"
       ORDER BY pv2."created_at" ASC
       LIMIT 1
     )`,
  `UPDATE "order_items" oi
   SET
     "variant_id" = pv.id,
     "variant_name" = COALESCE(oi."variant_name", pv."name"),
     "quantity_value" = COALESCE(oi."quantity_value", pv."quantity_value"),
     "quantity_unit" = COALESCE(oi."quantity_unit", pv."quantity_unit"),
     "pack_type" = COALESCE(oi."pack_type", pv."pack_type"),
     "mrp" = COALESCE(oi."mrp", pv."mrp")
   FROM "product_variants" pv
   WHERE oi."variant_id" IS NULL
     AND pv."product_id" = oi."product_id"
     AND pv.id = (
       SELECT pv2.id
       FROM "product_variants" pv2
       WHERE pv2."product_id" = oi."product_id"
       ORDER BY pv2."created_at" ASC
       LIMIT 1
     )`,
  `CREATE TABLE IF NOT EXISTS "stock_reservations" (
     "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     "user_id" UUID NOT NULL,
     "order_id" UUID,
     "product_variant_id" UUID NOT NULL,
     "quantity" INTEGER NOT NULL,
     "status" "StockReservationStatus" NOT NULL DEFAULT 'ACTIVE',
     "reason" TEXT,
     "expires_at" TIMESTAMPTZ(3) NOT NULL,
     "released_at" TIMESTAMPTZ(3),
     "finalized_at" TIMESTAMPTZ(3),
     "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
     "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
   )`,
  `DO $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_reservations_user_id_fkey') THEN
       ALTER TABLE "stock_reservations"
         ADD CONSTRAINT "stock_reservations_user_id_fkey"
         FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_reservations_order_id_fkey') THEN
       ALTER TABLE "stock_reservations"
         ADD CONSTRAINT "stock_reservations_order_id_fkey"
         FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_reservations_product_variant_id_fkey') THEN
       ALTER TABLE "stock_reservations"
         ADD CONSTRAINT "stock_reservations_product_variant_id_fkey"
         FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cart_items_variant_id_fkey') THEN
       ALTER TABLE "cart_items"
         ADD CONSTRAINT "cart_items_variant_id_fkey"
         FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_variant_id_fkey') THEN
       ALTER TABLE "order_items"
         ADD CONSTRAINT "order_items_variant_id_fkey"
         FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
     END IF;
   END $$`,
  `DROP INDEX IF EXISTS "cart_items_cart_id_product_id_key"`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "cart_items_cart_id_product_id_variant_id_key"
     ON "cart_items"("cart_id", "product_id", "variant_id")`,
  `CREATE INDEX IF NOT EXISTS "products_unit_group_quantity_unit_idx" ON "products"("unit_group", "quantity_unit")`,
  `CREATE INDEX IF NOT EXISTS "product_variants_unit_group_quantity_unit_idx" ON "product_variants"("unit_group", "quantity_unit")`,
  `CREATE INDEX IF NOT EXISTS "product_variants_stock_on_hand_stock_reserved_idx" ON "product_variants"("stock_on_hand", "stock_reserved")`,
  `CREATE INDEX IF NOT EXISTS "cart_items_variant_id_idx" ON "cart_items"("variant_id")`,
  `CREATE INDEX IF NOT EXISTS "order_items_variant_id_idx" ON "order_items"("variant_id")`,
  `CREATE INDEX IF NOT EXISTS "stock_reservations_product_variant_id_status_idx" ON "stock_reservations"("product_variant_id", "status")`,
  `CREATE INDEX IF NOT EXISTS "stock_reservations_status_expires_at_idx" ON "stock_reservations"("status", "expires_at")`,
  `CREATE INDEX IF NOT EXISTS "stock_reservations_user_id_status_idx" ON "stock_reservations"("user_id", "status")`,
  `DO $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_stock_non_negative') THEN
       ALTER TABLE "product_variants"
         ADD CONSTRAINT "product_variants_stock_non_negative"
         CHECK ("stock_on_hand" >= 0 AND "stock_reserved" >= 0 AND "stock" >= 0);
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_quantity_positive') THEN
       ALTER TABLE "product_variants"
         ADD CONSTRAINT "product_variants_quantity_positive"
         CHECK ("quantity_value" > 0 AND "normalized_value" > 0);
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_variants_price_valid') THEN
       ALTER TABLE "product_variants"
         ADD CONSTRAINT "product_variants_price_valid"
         CHECK ("price" >= 0 AND ("mrp" IS NULL OR "mrp" >= "price") AND ("cost_price" IS NULL OR "cost_price" >= 0));
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_measurement_quantity_positive') THEN
       ALTER TABLE "products"
         ADD CONSTRAINT "products_measurement_quantity_positive"
         CHECK ("quantity_value" > 0 AND "normalized_value" > 0);
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stock_reservations_quantity_positive') THEN
       ALTER TABLE "stock_reservations"
         ADD CONSTRAINT "stock_reservations_quantity_positive"
         CHECK ("quantity" > 0);
     END IF;
   END $$`
];
