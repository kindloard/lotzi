import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { recordCheckoutQueryTrace, shouldEnableCheckoutQueryEvents } from "../modules/checkout/checkout-tracing";
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
      log: shouldEnableCheckoutQueryEvents()
        ? [{ emit: "event", level: "query" }]
        : undefined,
      transactionOptions: {
        maxWait: positiveIntFromEnv("PRISMA_TRANSACTION_MAX_WAIT_MS", 10_000),
        timeout: positiveIntFromEnv("PRISMA_TRANSACTION_TIMEOUT_MS", 30_000)
      }
    });
  }

  async onModuleInit() {
    this.attachCheckoutQueryTracing();
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

  private attachCheckoutQueryTracing() {
    if (!shouldEnableCheckoutQueryEvents()) {
      return;
    }
    (this as unknown as { $on(event: "query", callback: (event: Prisma.QueryEvent) => void): void }).$on(
      "query",
      (event) => recordCheckoutQueryTrace(event)
    );
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
