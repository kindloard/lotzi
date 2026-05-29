import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { WebhookEventStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { ProductInventoryService } from "../products/product-inventory.service";
import { ReconciliationService } from "./reconciliation.service";
import { WebhookService } from "./webhook.service";

@Injectable()
export class PaymentWorkersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentWorkersService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: ProductInventoryService,
    private readonly reconciliation: ReconciliationService,
    private readonly webhooks: WebhookService
  ) {}

  onModuleInit() {
    if (process.env.PAYMENT_WORKERS_DISABLED === "true") {
      return;
    }
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
      await this.inventory.expireReservations(100);
      await this.reconciliation.runDue(25);
      const webhooks = await this.prisma.webhookEvent.findMany({
        where: {
          status: { in: [WebhookEventStatus.RECEIVED, WebhookEventStatus.FAILED] },
          nextRunAt: { lte: new Date() }
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
