import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { verifyProductCatalogSchema } from "../scripts/product-catalog-schema";

export interface RlsContext {
  userId: string;
  storeId?: string;
  isPlatformAdmin?: boolean;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      transactionOptions: {
        maxWait: positiveIntFromEnv("PRISMA_TRANSACTION_MAX_WAIT_MS", 10_000),
        timeout: positiveIntFromEnv("PRISMA_TRANSACTION_TIMEOUT_MS", 30_000)
      }
    });
  }

  async onModuleInit() {
    await this.$connect();
    await this.assertSchemaCompatibility();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  withRlsContext<T>(
    context: RlsContext,
    callback: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${context.userId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_store_id', ${context.storeId ?? ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_platform_admin', ${context.isPlatformAdmin ? "true" : "false"}, true)`;
      return callback(tx);
    });
  }

  private async assertSchemaCompatibility() {
    if (process.env.SKIP_DATABASE_SCHEMA_CHECK === "true") {
      return;
    }

    const report = await verifyProductCatalogSchema(this);
    const authMissing = await this.missingAuthSessionColumns();
    const accountMissing = await this.missingCustomerAccountColumns();

    if (report.ok && authMissing.length === 0 && accountMissing.length === 0) {
      return;
    }

    if (!report.ok) {
      const details = report.missing
      .slice(0, 12)
      .map((issue) => `${issue.kind}:${issue.name}${issue.details ? ` (${issue.details})` : ""}`)
      .join(", ");
      const suffix = report.missing.length > 12 ? `, +${report.missing.length - 12} more` : "";
      throw new Error(
        `Database schema is out of date for product catalog. Run npm run migration:repair-product-catalog and migration verification. Missing: ${details}${suffix}`
      );
    }

    if (accountMissing.length > 0) {
      throw new Error(
        `Database schema is out of date for customer accounts. Apply migration 20260527130000_customer_account_profile. Missing: ${accountMissing.join(", ")}`
      );
    }

    throw new Error(
      `Database schema is out of date for auth sessions. Apply migration 20260526113000_auth_refresh_lineage. Missing: ${authMissing.join(", ")}`
    );
  }

  private async missingAuthSessionColumns() {
    const required = [
      "sessions.refresh_token_jti",
      "sessions.refresh_token_parent_jti",
      "sessions.refresh_token_issued_at",
      "sessions.client_secret_hash",
      "refresh_token_history.refresh_token_jti",
      "refresh_token_history.replacement_refresh_token_jti",
      "refresh_token_history.device_fingerprint"
    ];
    const rows = await this.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('sessions', 'refresh_token_history')
    `;
    const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
    return required.filter((name) => !present.has(name));
  }

  private async missingCustomerAccountColumns() {
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
    const rows = await this.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('addresses', 'orders', 'account_deletion_requests')
    `;
    const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
    return required.filter((name) => !present.has(name));
  }
}

function positiveIntFromEnv(key: string, fallback: number) {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
