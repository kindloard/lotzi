const { PrismaClient, Prisma } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const storeId = '1fc57307-2833-4a96-a7c6-810bcdc2d206';
  const variantId = '18fdeea6-e95e-464e-8c9f-cf30d5185c39'; // available is currently 0, let's artificially set to 1
  
  await prisma.inventoryItem.updateMany({
    where: { productVariantId: variantId, storeId },
    data: { availableStock: 1 }
  });

  const tx = prisma;
  
  await tx.$executeRaw`
        SELECT
          set_config('lock_timeout', '2s', true),
          set_config('app.current_store_id', ${storeId}, true),
          set_config('app.is_platform_admin', 'false', true)
      `;
      
  const lineValues = Prisma.sql`(
        ${'cdf50251-97ff-41f3-a39c-b6b24bb38ba2'}::uuid,
        ${variantId}::uuid,
        ${'aachi'}::text,
        ${'aachi'}::text,
        ${'100g'}::text,
        ${100}::numeric,
        ${'G'}::"PackType",
        ${'PACK'}::"PackType",
        ${1}::integer,
        ${40.0}::numeric,
        ${40.0}::numeric,
        ${40.0}::numeric,
        ${4000}::bigint,
        ${0}::bigint,
        ${0}::bigint,
        ${4000}::bigint,
        ${'d1512411-e40e-4dd1-a083-d250c608f1b2'}::uuid
      )`;

  const rows = await tx.$queryRaw`
      WITH
      input_items (
        product_id,
        variant_id,
        name,
        variant_name,
        unit_display,
        quantity_value,
        quantity_unit,
        pack_type,
        quantity,
        unit_price,
        mrp,
        total,
        unit_price_paise,
        discount_paise,
        tax_paise,
        total_paise,
        reservation_id
      ) AS (
        VALUES ${lineValues}
      ),
      default_location AS (
        SELECT il.id
        FROM inventory_locations il
        WHERE il.store_id = ${storeId}::uuid
          AND il.is_default = true
        ORDER BY il.created_at ASC
        LIMIT 1
      ),
      locked_inventory AS (
        SELECT
          ii.id,
          ii.store_id,
          ii.product_variant_id,
          ii.location_id,
          ii.available_stock,
          ii.reserved_stock,
          ii.sold_stock,
          ii.low_stock_threshold,
          ii.version,
          input_items.quantity,
          input_items.reservation_id
        FROM input_items
        JOIN inventory_items ii
          ON ii.product_variant_id = input_items.variant_id
         AND ii.store_id = ${storeId}::uuid
        JOIN default_location dl ON dl.id = ii.location_id
        ORDER BY ii.product_variant_id
        FOR UPDATE
      ),
      stock_check AS (
        SELECT
          COUNT(*)::integer AS locked_count,
          COUNT(*) FILTER (WHERE available_stock >= quantity)::integer AS available_count
        FROM locked_inventory
      )
      SELECT * FROM stock_check;
  `;
  console.dir(rows, { depth: null });
}
main();
