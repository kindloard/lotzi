import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { WebhookEventStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { InventoryService } from "../inventory/inventory.service";
import { ReconciliationService } from "./reconciliation.service";
import { WebhookService } from "./webhook.service";
import { RedisService } from "../redis/redis.service";

const STALE_WEBHOOK_PROCESSING_MS = 2 * 60 * 1000;

@Injectable()
export class PaymentWorkersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentWorkersService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly reconciliation: ReconciliationService,
    private readonly webhooks: WebhookService,
    private readonly redis: RedisService
  ) {}

  onModuleInit() {
    if (process.env.PAYMENT_WORKERS_DISABLED === "true") {
      return;
    }
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, 30_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async tick() {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const lock = await this.redis.setNxEx("lock:payment_worker", 25, "1");
      if (!lock) return;

      await this.inventory.expireReservations(100);
      await this.reconciliation.runDue(25);
      const now = new Date();
      const staleProcessingBefore = new Date(Date.now() - STALE_WEBHOOK_PROCESSING_MS);
      const webhooks = await this.prisma.webhookEvent.findMany({
        where: {
          OR: [
            {
              status: { in: [WebhookEventStatus.RECEIVED, WebhookEventStatus.FAILED] },
              nextRunAt: { lte: now }
            },
            {
              status: WebhookEventStatus.PROCESSING,
              updatedAt: { lte: staleProcessingBefore }
            }
          ]
        },
        orderBy: { nextRunAt: "asc" },
        take: 25,
        select: { id: true }
      });
      for (const webhook of webhooks) {
        await this.webhooks.processWebhook(webhook.id);
      }
    } catch (error) {
      this.logger.warn(`Payment worker tick failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
