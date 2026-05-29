import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import {
  OrderStatus,
  PaymentAttemptStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  ReconciliationReason,
  RefundStatus,
  StockReservationStatus
} from "@prisma/client";
import { randomUUID, createHash } from "node:crypto";
import { CashfreeClient, CashfreeGatewayError } from "../../integrations/cashfree/cashfree.client";
import { PrismaService } from "../../database/prisma.service";
import { AuthenticatedPrincipal } from "../auth/auth.types";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import { CreateRefundDto, RetryPaymentDto } from "./dto/payments.dto";
import { paymentError } from "./payment.errors";
import { PaymentTransitionService } from "./payment-transition.service";
import { INR, paiseToNumber, paiseToRupeeDecimal, paiseToCashfreeAmount } from "./money";

const ATTEMPT_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashfree: CashfreeClient,
    private readonly idempotency: IdempotencyService,
    private readonly rateLimit: RateLimitService,
    private readonly transitions: PaymentTransitionService
  ) {}

  async status(auth: AuthenticatedPrincipal, paymentId: string) {
    const payment = await this.ownedPayment(auth.userId, paymentId);
    const activeAttempt = payment.attempts[0] ?? null;
    return {
      apiVersion: "v1",
      payment: safePaymentStatus(payment, activeAttempt),
      recovery: recoveryFor(payment.status, activeAttempt?.status ?? null)
    };
  }

  async retry(auth: AuthenticatedPrincipal, paymentId: string, dto: RetryPaymentDto, requestId?: string) {
    await this.rateLimit.enforce(`payment:retry:${auth.userId}:${paymentId}`, 8, 60);
    const payment = await this.ownedPayment(auth.userId, paymentId);
    const retryableStatuses = new Set<PaymentStatus>([
      PaymentStatus.PENDING_GATEWAY,
      PaymentStatus.USER_DROPPED,
      PaymentStatus.UNKNOWN_GATEWAY
    ]);
    if (!retryableStatuses.has(payment.status)) {
      throw paymentError(HttpStatus.CONFLICT, "PAYMENT_RETRY_NOT_ALLOWED", "This payment cannot be retried.", false, {
        status: payment.status
      });
    }
    if (payment.order.expiresAt && payment.order.expiresAt <= new Date()) {
      throw paymentError(HttpStatus.CONFLICT, "PAYMENT_ORDER_EXPIRED", "This checkout has expired.");
    }

    const requestHash = this.idempotency.hash({ paymentId, operation: "payment.retry.v1" });
    const reservation = await this.idempotency.reserve({
      key: dto.idempotencyKey,
      userId: auth.userId,
      storeId: payment.order.storeId,
      operation: "payment.retry.v1",
      requestHash,
      ttlMs: 7 * 24 * 60 * 60 * 1000
    });
    if (reservation.state === "replayed") {
      return reservation.response;
    }

    try {
      const prepared = await this.prepareRetryAttempt(payment, dto.idempotencyKey, requestId);
      const order = await this.cashfree.createOrder({
        cashfreeOrderId: prepared.cashfreeOrderId,
        amountPaise: prepared.amountPaise,
        currency: payment.currency,
        customer: {
          id: payment.order.user.id,
          email: payment.order.user.email,
          name: payment.order.user.fullName,
          phone: payment.order.addressRecipientPhone ?? payment.order.user.phone
        },
        returnUrl: `${process.env.FRONTEND_URL ?? "http://localhost:3000"}/en/checkout/status?orderId=${payment.orderId}&paymentId=${payment.id}`,
        notifyUrl: process.env.CASHFREE_NOTIFY_URL,
        idempotencyKey: prepared.attemptId,
        metadata: {
          orderId: payment.orderId,
          paymentId: payment.id,
          attemptId: prepared.attemptId
        }
      });
      if (!order.payment_session_id) {
        throw new CashfreeGatewayError("Cashfree did not return a payment session.", true, 502, order);
      }
      const response = await this.markRetrySessionCreated(payment.id, payment.orderId, prepared.attemptId, order, requestId);
      await this.idempotency.complete(reservation, response);
      return response;
    } catch (error) {
      await this.idempotency.fail(reservation, errorBody(error));
      throw error;
    }
  }

  async verifyUserReturn(auth: AuthenticatedPrincipal, paymentId: string, requestId?: string) {
    await this.rateLimit.enforce(`payment:verify:${auth.userId}:${paymentId}`, 20, 60);
    const payment = await this.ownedPayment(auth.userId, paymentId);
    return this.verifyPaymentWithGateway(payment.cashfreeOrderId, requestId);
  }

  async verifyPaymentWithGateway(cashfreeOrderId: string | null, requestId?: string) {
    if (!cashfreeOrderId) {
      throw paymentError(HttpStatus.BAD_REQUEST, "CASHFREE_ORDER_MISSING", "Payment is missing a Cashfree order id.");
    }
    const [order, payments] = await Promise.all([
      this.cashfree.getOrder(cashfreeOrderId),
      this.cashfree.getPaymentsForOrder(cashfreeOrderId).catch(() => [])
    ]);
    const successful = payments.find((payment) => gatewayPaymentStatus(payment.payment_status) === "PAID");
    const local = await this.prisma.payment.findFirst({
      where: { cashfreeOrderId },
      include: paymentInclude()
    });
    if (!local) {
      throw paymentError(HttpStatus.NOT_FOUND, "PAYMENT_NOT_FOUND", "Payment not found.");
    }

    if (successful) {
      return this.confirmPaid(local.id, {
        cashfreePaymentId: String(successful.cf_payment_id ?? ""),
        amountPaise: gatewayAmountToPaise(successful.payment_amount),
        currency: successful.payment_currency ?? local.currency,
        gatewayOrder: order,
        gatewayPayment: successful,
        requestId
      });
    }

    const mappedOrderStatus = gatewayOrderStatus(order.order_status);
    if (mappedOrderStatus === "FAILED" || mappedOrderStatus === "EXPIRED" || mappedOrderStatus === "USER_DROPPED") {
      return this.markGatewayFailure(local.id, mappedOrderStatus, { order, payments }, requestId);
    }

    return {
      apiVersion: "v1",
      status: "PENDING_GATEWAY",
      payment: safePaymentStatus(local, local.attempts[0] ?? null),
      gateway: { orderStatus: order.order_status }
    };
  }

  async confirmPaid(paymentId: string, input: {
    cashfreePaymentId: string;
    amountPaise: bigint;
    currency: string;
    gatewayOrder: unknown;
    gatewayPayment: unknown;
    requestId?: string;
  }) {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: paymentInclude()
    });

    if (payment.status === PaymentStatus.PAID) {
      if (payment.cashfreePaymentId && input.cashfreePaymentId && payment.cashfreePaymentId !== input.cashfreePaymentId) {
        await this.createReconciliation(payment.id, ReconciliationReason.DUPLICATE_SUCCESS, "DUPLICATE_SUCCESS", {
          existing: payment.cashfreePaymentId,
          incoming: input.cashfreePaymentId
        });
      }
      return {
        apiVersion: "v1",
        status: "PAID",
        payment: safePaymentStatus(payment, payment.attempts[0] ?? null)
      };
    }

    if (payment.amountPaise !== input.amountPaise || payment.currency !== input.currency) {
      await this.createReconciliation(payment.id, ReconciliationReason.AMOUNT_MISMATCH, "AMOUNT_MISMATCH", {
        localAmountPaise: payment.amountPaise.toString(),
        gatewayAmountPaise: input.amountPaise.toString(),
        localCurrency: payment.currency,
        gatewayCurrency: input.currency
      });
      throw paymentError(HttpStatus.CONFLICT, "PAYMENT_AMOUNT_MISMATCH", "Gateway amount does not match the order total.");
    }

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: { order: true, attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } }
      });
      if (current.status === PaymentStatus.PAID) {
        return;
      }
      const activeAttempt = current.attempts[0];
      await tx.paymentAttempt.updateMany({
        where: { paymentId: payment.id, status: { in: activeAttemptStatuses() } },
        data: {
          status: PaymentAttemptStatus.PAID,
          cashfreePaymentId: input.cashfreePaymentId,
          gatewayResponse: input.gatewayPayment as Prisma.InputJsonValue
        }
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          cashfreePaymentId: input.cashfreePaymentId,
          gatewayResponse: {
            order: input.gatewayOrder,
            payment: input.gatewayPayment
          } as Prisma.InputJsonValue,
          verifiedAt: new Date()
        }
      });
      await this.transitions.transitionPayment(tx, {
        paymentId: payment.id,
        orderId: payment.orderId,
        attemptId: activeAttempt?.id,
        from: current.status,
        to: PaymentStatus.PAID,
        context: { reason: "cashfree_paid_verified", requestId: input.requestId }
      });
      await tx.order.update({
        where: { id: payment.orderId },
        data: { paymentStatus: PaymentStatus.PAID }
      });
      if (current.order.status === OrderStatus.PENDING_PAYMENT) {
        await this.transitions.transitionOrder(tx, {
          orderId: payment.orderId,
          from: current.order.status,
          to: OrderStatus.PAYMENT_CONFIRMED,
          context: { reason: "payment_paid", requestId: input.requestId }
        });
        await finalizeOrderReservations(tx, payment.orderId);
        await this.transitions.transitionOrder(tx, {
          orderId: payment.orderId,
          from: OrderStatus.PAYMENT_CONFIRMED,
          to: OrderStatus.FULFILLMENT_READY,
          context: { reason: "inventory_finalized", requestId: input.requestId }
        });
      }
      await tx.domainEvent.create({
        data: {
          schemaVersion: 1,
          eventType: "payment.paid",
          aggregateType: "payment",
          aggregateId: payment.id,
          idempotencyKey: input.cashfreePaymentId,
          producer: "namastore-api",
          payload: {
            orderId: payment.orderId,
            paymentId: payment.id,
            cashfreePaymentId: input.cashfreePaymentId,
            amountPaise: input.amountPaise.toString()
          } as Prisma.InputJsonValue
        }
      });
    });

    const updated = await this.prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: paymentInclude()
    });
    return {
      apiVersion: "v1",
      status: "PAID",
      payment: safePaymentStatus(updated, updated.attempts[0] ?? null)
    };
  }

  async markGatewayFailure(paymentId: string, status: "FAILED" | "EXPIRED" | "USER_DROPPED", payload: unknown, requestId?: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: paymentInclude()
    });
    if (payment.status === PaymentStatus.PAID) {
      return { apiVersion: "v1", status: "PAID", payment: safePaymentStatus(payment, payment.attempts[0] ?? null) };
    }
    const nextPaymentStatus =
      status === "EXPIRED" ? PaymentStatus.EXPIRED : status === "USER_DROPPED" ? PaymentStatus.USER_DROPPED : PaymentStatus.FAILED;
    const nextAttemptStatus =
      status === "EXPIRED" ? PaymentAttemptStatus.EXPIRED : status === "USER_DROPPED" ? PaymentAttemptStatus.USER_DROPPED : PaymentAttemptStatus.FAILED;

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: { order: true, attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } }
      });
      if (current.status === PaymentStatus.PAID) {
        return;
      }
      await tx.paymentAttempt.updateMany({
        where: { paymentId: payment.id, status: { in: activeAttemptStatuses() } },
        data: { status: nextAttemptStatus, gatewayResponse: payload as Prisma.InputJsonValue }
      });
      await this.transitions.transitionPayment(tx, {
        paymentId: payment.id,
        orderId: payment.orderId,
        attemptId: current.attempts[0]?.id,
        from: current.status,
        to: nextPaymentStatus,
        context: { reason: `cashfree_${status.toLowerCase()}`, requestId, metadata: payload as Prisma.InputJsonValue }
      });
      if (nextPaymentStatus === PaymentStatus.FAILED || nextPaymentStatus === PaymentStatus.EXPIRED) {
        await releaseOrderReservations(tx, payment.orderId, `payment_${nextPaymentStatus.toLowerCase()}`);
        await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: nextPaymentStatus } });
        await this.transitions.transitionOrder(tx, {
          orderId: payment.orderId,
          from: current.order.status,
          to: nextPaymentStatus === PaymentStatus.EXPIRED ? OrderStatus.EXPIRED : OrderStatus.PAYMENT_FAILED,
          context: { reason: `payment_${nextPaymentStatus.toLowerCase()}`, requestId }
        });
      }
    });

    const updated = await this.prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: paymentInclude()
    });
    return {
      apiVersion: "v1",
      status: updated.status,
      payment: safePaymentStatus(updated, updated.attempts[0] ?? null)
    };
  }

  async refund(auth: AuthenticatedPrincipal, paymentId: string, dto: CreateRefundDto, requestId?: string) {
    await this.rateLimit.enforce(`payment:refund:${auth.userId}:${paymentId}`, 5, 60);
    const payment = await this.ownedPayment(auth.userId, paymentId);
    if (payment.status !== PaymentStatus.PAID && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      throw paymentError(HttpStatus.CONFLICT, "REFUND_NOT_ALLOWED", "Only paid payments can be refunded.");
    }
    const amountPaise = BigInt(dto.amountPaise);
    if (amountPaise <= 0n || amountPaise > payment.amountPaise - payment.refundedPaise) {
      throw paymentError(HttpStatus.BAD_REQUEST, "REFUND_AMOUNT_INVALID", "Refund amount exceeds refundable balance.");
    }
    if (!payment.cashfreePaymentId) {
      throw paymentError(HttpStatus.CONFLICT, "REFUND_GATEWAY_PAYMENT_MISSING", "Cashfree payment id is missing.");
    }

    const requestHash = this.idempotency.hash({ paymentId, amountPaise: amountPaise.toString(), reason: dto.reason });
    const reservation = await this.idempotency.reserve({
      key: dto.idempotencyKey,
      userId: auth.userId,
      storeId: payment.order.storeId,
      operation: "payment.refund.create.v1",
      requestHash,
      ttlMs: 7 * 24 * 60 * 60 * 1000
    });
    if (reservation.state === "replayed") {
      return reservation.response;
    }

    const refundId = `rf_${randomUUID()}`;
    const created = await this.prisma.refund.create({
      data: {
        refundId,
        orderId: payment.orderId,
        paymentId: payment.id,
        amountPaise,
        currency: payment.currency,
        reason: dto.reason,
        idempotencyKey: dto.idempotencyKey,
        status: RefundStatus.INITIATED
      }
    });
    try {
      const gateway = await this.cashfree.createRefund({
        cashfreePaymentId: payment.cashfreePaymentId,
        refundId,
        amountPaise,
        reason: dto.reason,
        idempotencyKey: created.id
      });
      await this.prisma.$transaction(async (tx) => {
        const newRefunded = payment.refundedPaise + amountPaise;
        await tx.refund.update({
          where: { id: created.id },
          data: {
            status: RefundStatus.SUCCESS,
            cashfreeRefundId: stringOrNull(gateway.cf_refund_id) ?? stringOrNull(gateway.refund_id),
            gatewayResponse: gateway as Prisma.InputJsonValue,
            processedAt: new Date()
          }
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            refundedPaise: newRefunded,
            status: newRefunded >= payment.amountPaise ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED
          }
        });
        await tx.paymentEvent.create({
          data: {
            paymentId: payment.id,
            orderId: payment.orderId,
            eventType: "payment.refund.completed",
            fromStatus: payment.status,
            toStatus: newRefunded >= payment.amountPaise ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
            actorType: "CUSTOMER",
            actorUserId: auth.userId,
            reason: dto.reason ?? "refund_requested",
            requestId,
            payload: { refundId, amountPaise: amountPaise.toString(), gateway } as Prisma.InputJsonValue
          }
        });
      });
      const response = { apiVersion: "v1", refundId, status: "SUCCESS" };
      await this.idempotency.complete(reservation, response);
      return response;
    } catch (error) {
      await this.prisma.refund.update({
        where: { id: created.id },
        data: { status: RefundStatus.FAILED, gatewayResponse: errorBody(error) as Prisma.InputJsonValue }
      }).catch(() => undefined);
      await this.idempotency.fail(reservation, errorBody(error));
      throw error;
    }
  }

  private async prepareRetryAttempt(
    payment: Awaited<ReturnType<PaymentsService["ownedPayment"]>>,
    idempotencyKey: string,
    requestId?: string
  ) {
    const attemptNumber = (await this.prisma.paymentAttempt.count({ where: { paymentId: payment.id } })) + 1;
    const attemptId = randomUUID();
    const cashfreeOrderId = `nma_${payment.orderId.replace(/-/g, "").slice(0, 28)}_${attemptNumber}`;
    const expiresAt = new Date(Date.now() + ATTEMPT_TTL_MS);
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentAttempt.updateMany({
        where: { paymentId: payment.id, status: { in: activeAttemptStatuses() } },
        data: { status: PaymentAttemptStatus.USER_DROPPED }
      });
      await tx.paymentAttempt.create({
        data: {
          id: attemptId,
          paymentId: payment.id,
          orderId: payment.orderId,
          attemptNumber,
          status: PaymentAttemptStatus.INITIATED,
          cashfreeOrderId,
          amountPaise: payment.amountPaise,
          currency: payment.currency,
          idempotencyKey,
          expiresAt,
          gatewayRequest: { retry: true, previousStatus: payment.status } as Prisma.InputJsonValue
        }
      });
      if (payment.status !== PaymentStatus.PENDING_GATEWAY) {
        await this.transitions.transitionPayment(tx, {
          paymentId: payment.id,
          orderId: payment.orderId,
          attemptId,
          from: payment.status,
          to: PaymentStatus.PENDING_GATEWAY,
          context: { reason: "payment_retry_started", requestId }
        });
      }
    });
    return { attemptId, cashfreeOrderId, amountPaise: payment.amountPaise };
  }

  private async markRetrySessionCreated(
    paymentId: string,
    orderId: string,
    attemptId: string,
    cashfreeOrder: Record<string, unknown>,
    requestId?: string
  ) {
    const paymentSessionId = String(cashfreeOrder.payment_session_id);
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentAttempt.update({
        where: { id: attemptId },
        data: {
          status: PaymentAttemptStatus.PENDING_GATEWAY,
          cashfreeCfOrderId: stringOrNull(cashfreeOrder.cf_order_id),
          paymentSessionIdHash: createHash("sha256").update(paymentSessionId).digest("hex"),
          gatewayResponse: cashfreeOrder as Prisma.InputJsonValue
        }
      });
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          cashfreeOrderId: stringOrNull(cashfreeOrder.order_id),
          cashfreeCfOrderId: stringOrNull(cashfreeOrder.cf_order_id),
          gatewayResponse: cashfreeOrder as Prisma.InputJsonValue
        }
      });
      await tx.paymentEvent.create({
        data: {
          paymentId,
          orderId,
          attemptId,
          eventType: "payment.retry.session.created",
          fromStatus: PaymentStatus.PENDING_GATEWAY,
          toStatus: PaymentStatus.PENDING_GATEWAY,
          reason: "cashfree_retry_session_created",
          requestId,
          payload: cashfreeOrder as Prisma.InputJsonValue
        }
      });
    });
    return {
      apiVersion: "v1",
      status: "SESSION_CREATED",
      paymentId,
      orderId,
      attemptId,
      cashfreeOrderId: stringOrNull(cashfreeOrder.order_id),
      paymentSessionId,
      totals: {
        currency: INR
      }
    };
  }

  private async ownedPayment(userId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, order: { userId } },
      include: paymentInclude()
    });
    if (!payment) {
      throw paymentError(HttpStatus.NOT_FOUND, "PAYMENT_NOT_FOUND", "Payment not found.");
    }
    return payment;
  }

  private async createReconciliation(paymentId: string, reason: ReconciliationReason, driftCode: string, details: Record<string, unknown>) {
    await this.prisma.reconciliationRun.create({
      data: {
        paymentId,
        reason,
        driftCode,
        details: details as Prisma.InputJsonValue,
        nextCheckAt: new Date()
      }
    });
  }
}

function paymentInclude() {
  return {
    order: { include: { user: true } },
    attempts: { orderBy: { attemptNumber: "desc" as const }, take: 1 }
  };
}

async function finalizeOrderReservations(tx: Prisma.TransactionClient, orderId: string) {
  const reservations = await tx.stockReservation.findMany({
    where: { orderId, status: StockReservationStatus.ACTIVE }
  });
  for (const reservation of reservations) {
    const updated = await tx.$executeRaw`
      UPDATE product_variants
      SET stock_on_hand = stock_on_hand - ${reservation.quantity},
          stock_reserved = GREATEST(stock_reserved - ${reservation.quantity}, 0),
          stock = GREATEST(stock_on_hand - ${reservation.quantity}, 0),
          stock_version = stock_version + 1,
          updated_at = now()
      WHERE id = ${reservation.productVariantId}::uuid
        AND stock_on_hand >= ${reservation.quantity}
        AND stock_reserved >= ${reservation.quantity}
    `;
    if (updated !== 1) {
      throw paymentError(HttpStatus.CONFLICT, "INVENTORY_FINALIZE_FAILED", "Inventory changed before payment confirmation.");
    }
    await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { status: StockReservationStatus.FINALIZED, finalizedAt: new Date() }
    });
  }
}

async function releaseOrderReservations(tx: Prisma.TransactionClient, orderId: string, reason: string) {
  const reservations = await tx.stockReservation.findMany({
    where: { orderId, status: StockReservationStatus.ACTIVE }
  });
  for (const reservation of reservations) {
    await tx.$executeRaw`
      UPDATE product_variants
      SET stock_reserved = GREATEST(stock_reserved - ${reservation.quantity}, 0),
          stock_version = stock_version + 1,
          updated_at = now()
      WHERE id = ${reservation.productVariantId}::uuid
    `;
    await tx.stockReservation.update({
      where: { id: reservation.id },
      data: { status: StockReservationStatus.RELEASED, reason, releasedAt: new Date() }
    });
  }
}

function activeAttemptStatuses() {
  return [
    PaymentAttemptStatus.INITIATED,
    PaymentAttemptStatus.SESSION_CREATED,
    PaymentAttemptStatus.PENDING_GATEWAY,
    PaymentAttemptStatus.AUTHORIZED,
    PaymentAttemptStatus.UNKNOWN_GATEWAY
  ];
}

function gatewayPaymentStatus(status: string | undefined): "PAID" | "FAILED" | "PENDING" | "USER_DROPPED" {
  const normalized = (status ?? "").toUpperCase();
  if (normalized === "SUCCESS" || normalized === "PAID") return "PAID";
  if (normalized === "USER_DROPPED") return "USER_DROPPED";
  if (normalized === "FAILED" || normalized === "CANCELLED" || normalized === "VOID") return "FAILED";
  return "PENDING";
}

function gatewayOrderStatus(status: string | undefined): "PAID" | "FAILED" | "EXPIRED" | "USER_DROPPED" | "PENDING" {
  const normalized = (status ?? "").toUpperCase();
  if (normalized === "PAID") return "PAID";
  if (normalized === "EXPIRED") return "EXPIRED";
  if (normalized === "USER_DROPPED") return "USER_DROPPED";
  if (normalized === "FAILED" || normalized === "TERMINATED") return "FAILED";
  return "PENDING";
}

function gatewayAmountToPaise(value: unknown): bigint {
  if (typeof value === "number") {
    return BigInt(Math.round(value * 100));
  }
  if (typeof value === "string") {
    return BigInt(Math.round(Number(value) * 100));
  }
  return 0n;
}

function recoveryFor(status: PaymentStatus, attemptStatus: PaymentAttemptStatus | null) {
  if (status === PaymentStatus.PAID) return { action: "TRACK_ORDER", pollAfterMs: null };
  if (status === PaymentStatus.UNKNOWN_GATEWAY) return { action: "WAIT_RECONCILIATION", pollAfterMs: 15_000 };
  if (status === PaymentStatus.PENDING_GATEWAY || attemptStatus === PaymentAttemptStatus.PENDING_GATEWAY) {
    return { action: "POLL", pollAfterMs: 2_000 };
  }
  if (status === PaymentStatus.USER_DROPPED) return { action: "RETRY", pollAfterMs: null };
  if (status === PaymentStatus.EXPIRED) return { action: "NEW_CHECKOUT", pollAfterMs: null };
  return { action: "CONTACT_SUPPORT", pollAfterMs: null };
}

function safePaymentStatus(
  payment: {
    id: string;
    orderId: string;
    status: PaymentStatus;
    amountPaise: bigint;
    currency: string;
    cashfreeOrderId: string | null;
    cashfreePaymentId: string | null;
    verifiedAt: Date | null;
    order: { id: string; status: OrderStatus; paymentStatus: PaymentStatus; grandTotalPaise: bigint; expiresAt: Date | null };
  },
  attempt: { id: string; attemptNumber: number; status: PaymentAttemptStatus; expiresAt: Date | null } | null
) {
  return {
    id: payment.id,
    orderId: payment.orderId,
    status: payment.status,
    orderStatus: payment.order.status,
    paymentStatus: payment.order.paymentStatus,
    amountPaise: payment.amountPaise.toString(),
    amount: paiseToNumber(payment.amountPaise),
    currency: payment.currency,
    cashfreeOrderId: payment.cashfreeOrderId,
    cashfreePaymentId: payment.cashfreePaymentId,
    verifiedAt: payment.verifiedAt?.toISOString() ?? null,
    expiresAt: payment.order.expiresAt?.toISOString() ?? null,
    attempt: attempt
      ? {
          id: attempt.id,
          attemptNumber: attempt.attemptNumber,
          status: attempt.status,
          expiresAt: attempt.expiresAt?.toISOString() ?? null
        }
      : null
  };
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function errorBody(error: unknown): Prisma.InputJsonObject {
  if (error instanceof CashfreeGatewayError) {
    return {
      code: "CASHFREE_GATEWAY_ERROR",
      message: error.message,
      retryable: error.retryable,
      status: error.status ?? null,
      responseBody: (error.responseBody ?? null) as Prisma.InputJsonValue
    };
  }
  return { code: "PAYMENT_ERROR", message: error instanceof Error ? error.message : String(error) };
}
