import { PrismaClient } from "@prisma/client";
import { verifyProductCatalogSchema } from "./product-catalog-schema";

async function missingAuthSessionColumns(prisma: PrismaClient) {
  const required = [
    "sessions.refresh_token_jti",
    "sessions.refresh_token_parent_jti",
    "sessions.refresh_token_issued_at",
    "sessions.client_secret_hash",
    "refresh_token_history.refresh_token_jti",
    "refresh_token_history.replacement_refresh_token_jti",
    "refresh_token_history.device_fingerprint"
  ];
  const rows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('sessions', 'refresh_token_history')
  `;
  const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  return required.filter((name) => !present.has(name));
}

async function missingCustomerAccountColumns(prisma: PrismaClient) {
  const required = [
    "addresses.recipient_name",
    "addresses.recipient_phone",
    "addresses.delivery_instructions",
    "addresses.is_default",
    "addresses.version",
    "addresses.deleted_at",
    "orders.address_recipient_name",
    "orders.address_recipient_phone",
    "orders.address_line1",
    "orders.address_line2",
    "orders.address_city",
    "orders.address_state",
    "orders.address_pincode",
    "orders.address_latitude",
    "orders.address_longitude",
    "account_deletion_requests.id",
    "account_deletion_requests.user_id",
    "account_deletion_requests.confirmation_hash",
    "account_deletion_requests.confirmation_nonce",
    "account_deletion_requests.requested_ip",
    "account_deletion_requests.consumed_at",
    "account_deletion_requests.expires_at",
    "account_deletion_requests.cooldown_until",
    "account_deletion_requests.created_at"
  ];
  const rows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('addresses', 'orders', 'account_deletion_requests')
  `;
  const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  return required.filter((name) => !present.has(name));
}

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();
  console.log("Connected to Prisma database.");

  try {
    const report = await verifyProductCatalogSchema(prisma as any);
    const authMissing = await missingAuthSessionColumns(prisma);
    const accountMissing = await missingCustomerAccountColumns(prisma);

    let hasErrors = false;

    if (!report.ok) {
      hasErrors = true;
      const details = report.missing
      .slice(0, 12)
      .map((issue) => `${issue.kind}:${issue.name}${issue.details ? ` (${issue.details})` : ""}`)
      .join(", ");
      const suffix = report.missing.length > 12 ? `, +${report.missing.length - 12} more` : "";
      console.error(`Database schema is out of date for product catalog. Run npm run migration:repair-product-catalog and migration verification. Missing: ${details}${suffix}`);
    }

    if (accountMissing.length > 0) {
      hasErrors = true;
      console.error(`Database schema is out of date for customer accounts. Apply migration 20260527130000_customer_account_profile. Missing: ${accountMissing.join(", ")}`);
    }

    if (authMissing.length > 0) {
      hasErrors = true;
      console.error(`Database schema is out of date for auth sessions. Apply migration 20260526113000_auth_refresh_lineage. Missing: ${authMissing.join(", ")}`);
    }

    if (hasErrors) {
      process.exit(1);
    } else {
      console.log("Schema verification passed.");
    }

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
