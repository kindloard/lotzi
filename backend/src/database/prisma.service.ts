import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { recordCheckoutQueryTrace, shouldEnableCheckoutQueryEvents } from "../modules/checkout/checkout-tracing";

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
  private readonly logger = new Logger(PrismaService.name);

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
    await this.connectWithRetry();
    this.attachCheckoutQueryTracing();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Verifies database connectivity via a lightweight query.
   * Used by health/readiness probes.
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async connectWithRetry() {
    const maxRetries = positiveIntFromEnv("PRISMA_CONNECT_RETRIES", 5);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const start = Date.now();
        await this.$connect();
        this.logger.log(
          `Database connected in ${Date.now() - start}ms (attempt ${attempt}/${maxRetries})`
        );
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === maxRetries) {
          this.logger.error(
            `Database connection failed after ${maxRetries} attempts: ${message}`
          );
          throw error;
        }
        const delayMs = Math.min(1000 * 2 ** (attempt - 1), 16_000);
        this.logger.warn(
          `Database connect attempt ${attempt}/${maxRetries} failed, retrying in ${delayMs}ms — ${message}`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
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
