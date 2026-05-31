import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PaymentProvider, Prisma, WebhookEventStatus } from "@prisma/client";
import { Request } from "express";
import { createHash } from "node:crypto";
import { CashfreeClient } from "../../integrations/cashfree/cashfree.client";
import { PrismaService } from "../../database/prisma.service";
import { PaymentsService } from "./payments.service";

const WEBHOOK_SKEW_MS = 5 * 60 * 1000;
const WEBHOOK_PROCESSING_STALE_MS = 2 * 60 * 1000;

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashfree: CashfreeClient,
    private readonly payments: PaymentsService
  ) {}

  async ingestCashfree(request: Request & { rawBody?: Buffer }) {
    const rawBody = request.rawBody;
    if (!rawBody?.length) {
      throw new BadRequestException("Webhook raw body is missing.");
    }
    const timestamp = header(request, "x-webhook-timestamp");
    const signature = header(request, "x-webhook-signature");
    if (!timestamp || !signature) {
      throw new BadRequestException("Webhook signature headers are missing.");
    }
    const timestampMs = Number(timestamp) * 1000;
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > WEBHOOK_SKEW_MS) {
      throw new BadRequestException("Webhook timestamp is outside the replay window.");
    }
    if (!this.cashfree.verifyWebhookSignature({ rawBody, timestamp, signature })) {
      throw new BadRequestException("Webhook signature verification failed.");
    }

    const payload = request.body as Record<string, unknown>;
    const payloadHash = createHash("sha256").update(rawBody).digest("hex");
    const eventType = stringAt(payload, ["type"]) ?? stringAt(payload, ["event_type"]) ?? "cashfree.unknown";
    const cashfreeOrderId = cashfreeOrderIdFromPayload(payload);
    const cashfreePaymentId = cashfreePaymentIdFromPayload(payload);
    const eventTime = stringAt(payload, ["event_time"]) ?? stringAt(payload, ["data", "event_time"]) ?? timestamp;
    const dedupeKey = createHash("sha256")
      .update([eventType, cashfreeOrderId, cashfreePaymentId, eventTime, payloadHash].join(":"))
      .digest("hex");
    const payment = cashfreeOrderId
      ? await this.prisma.payment.findFirst({ where: { cashfreeOrderId }, select: { id: true } })
      : null;

    let eventId: string | null = null;
    try {
      const created = await this.prisma.webhookEvent.create({
        data: {
          provider: PaymentProvider.CASHFREE,
          paymentId: payment?.id,
          eventType,
          eventVersion: stringAt(payload, ["event_version"]) ?? "2025-01-01",
          dedupeKey,
          payloadHash,
          signatureHash: createHash("sha256").update(signature).digest("hex"),
          headers: safeHeaders(request) as Prisma.InputJsonValue,
          rawPayload: payload as Prisma.InputJsonValue,
          status: WebhookEventStatus.RECEIVED,
          nextRunAt: new Date()
        },
        select: { id: true }
      });
      eventId = created.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { apiVersion: "v1", status: "DUPLICATE" };
      }
      throw error;
    }

    if (eventId) {
      void this.processWebhook(eventId).catch((error) => {
        this.logger.error(`Webhook async processing failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    return { apiVersion: "v1", status: "RECEIVED" };
  }

  async processWebhook(eventId: string) {
    const event = await this.prisma.webhookEvent.findUnique({ where: { id: eventId } });
    if (!event || event.status === WebhookEventStatus.PROCESSED || event.status === WebhookEventStatus.DLQ) {
      return;
    }
    const staleProcessingBefore = new Date(Date.now() - WEBHOOK_PROCESSING_STALE_MS);
    const claimed = await this.prisma.webhookEvent.updateMany({
      where: {
        id: event.id,
        OR: [
          { status: { in: [WebhookEventStatus.RECEIVED, WebhookEventStatus.FAILED] } },
          { status: WebhookEventStatus.PROCESSING, updatedAt: { lte: staleProcessingBefore } }
        ]
      },
      data: {
        status: WebhookEventStatus.PROCESSING,
        attempts: { increment: 1 },
        nextRunAt: new Date(Date.now() + WEBHOOK_PROCESSING_STALE_MS)
      }
    });
    if (claimed.count !== 1) {
      return;
    }
    const payload = event.rawPayload as Record<string, unknown>;
    const cashfreeOrderId = cashfreeOrderIdFromPayload(payload);
    try {
      await this.payments.verifyPaymentWithGateway(cashfreeOrderId, event.id);
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date(), lastError: null }
      });
    } catch (error) {
      const attempts = event.attempts + 1;
      const dlq = attempts >= 8;
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: dlq ? WebhookEventStatus.DLQ : WebhookEventStatus.FAILED,
          lastError: error instanceof Error ? error.message : String(error),
          nextRunAt: new Date(Date.now() + webhookBackoffMs(attempts))
        }
      });
      if (dlq) {
        this.logger.error(`Webhook ${event.id} moved to DLQ.`);
      }
    }
  }
}

function header(request: Request, name: string) {
  return request.header(name) ?? request.header(name.toLowerCase());
}

function cashfreeOrderIdFromPayload(payload: Record<string, unknown>) {
  return (
    stringAt(payload, ["data", "order", "order_id"]) ??
    stringAt(payload, ["data", "payment", "order_id"]) ??
    stringAt(payload, ["order_id"])
  );
}

function cashfreePaymentIdFromPayload(payload: Record<string, unknown>) {
  return (
    stringAt(payload, ["data", "payment", "cf_payment_id"]) ??
    stringAt(payload, ["data", "payment", "payment_id"]) ??
    stringAt(payload, ["cf_payment_id"])
  );
}

function stringAt(payload: Record<string, unknown>, path: string[]): string | null {
  let current: unknown = payload;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" || typeof current === "number" ? String(current) : null;
}

function safeHeaders(request: Request) {
  return {
    "x-webhook-timestamp": request.header("x-webhook-timestamp"),
    "x-webhook-signature-sha256": request.header("x-webhook-signature")
      ? createHash("sha256").update(request.header("x-webhook-signature")!).digest("hex")
      : undefined,
    "user-agent": request.header("user-agent")
  };
}

function webhookBackoffMs(attempts: number) {
  const schedule = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000, 6 * 60 * 60_000, 12 * 60 * 60_000, 24 * 60 * 60_000];
  return schedule[Math.min(attempts - 1, schedule.length - 1)]!;
}
