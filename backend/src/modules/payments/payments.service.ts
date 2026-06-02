import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import {
  OrderStatus,
  PaymentAttemptStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  ReconciliationReason,
  RefundStatus
} from "@prisma/client";
import { randomUUID, createHash } from "node:crypto";
import { CashfreeClient, CashfreeGatewayError } from "../../integrations/cashfree/cashfree.client";
import { PhonepeClient, PhonepeGatewayError } from "../../integrations/phonepe/phonepe.client";
import { PrismaService } from "../../database/prisma.service";
import { AuthenticatedPrincipal } from "../auth/auth.types";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { InventoryService } from "../inventory/inventory.service";
import { PaymentSettingsService } from "../payment-settings/payment-settings.service";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import { CreateRefundDto, RetryPaymentDto } from "./dto/payments.dto";
import { paymentError } from "./payment.errors";
import { PaymentTransitionService } from "./payment-transition.service";
import { INR, paiseToNumber, paiseToRupeeDecimal, paiseToCashfreeAmount } from "./money";

const ATTEMPT_TTL_MS = 15 * 60 * 1000;
const PAYMENT_CONFIRM_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;
const RELEASED_TERMINAL_SUCCESS_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.FAILED,
  PaymentStatus.EXPIRED
]);

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashfree: CashfreeClient,
    private readonly phonepe: PhonepeClient,
    private readonly idempotency: IdempotencyService,
    private readonly inventory: InventoryService,
    private readonly paymentSettings: PaymentSettingsService,
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

    if (payment.provider === PaymentProvider.PHONEPE) {
      try {
        const prepared = await this.preparePhonepeRetryAttempt(payment, dto.idempotencyKey, requestId);
        const credentials = await this.paymentSettings.resolvePhonepeCredentials(payment.order.storeId);
        const gateway = await this.phonepe.createPayment({
          credentials,
          merchantOrderId: prepared.merchantOrderId,
          amountPaise: payment.amountPaise,
          redirectUrl: `${process.env.FRONTEND_URL ?? "http://localhost:3000"}/en/checkout/status?orderId=${payment.orderId}&paymentId=${payment.id}`,
          metadata: {
            orderId: payment.orderId,
            paymentId: payment.id,
            attemptId: prepared.attemptId
          }
        });
        const redirectUrl = this.phonepe.redirectUrlFromResponse(gateway);
        if (!redirectUrl) {
          throw new PhonepeGatewayError("PhonePe did not return a redirect URL.", true, 502, gateway);
        }
        const response = await this.markPhonepeRetrySessionCreated(payment, prepared.attemptId, prepared.merchantOrderId, gateway, redirectUrl, requestId);
        await this.idempotency.complete(reservation, response);
        return response;
      } catch (error) {
        await this.idempotency.fail(reservation, errorBody(error));
        throw error;
      }
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
    if (payment.provider === PaymentProvider.PHONEPE) {
      return this.verifyPhonepePayment(payment.id, requestId);
    }
    if (payment.provider === PaymentProvider.COD) {
      return {
        apiVersion: "v1",
        status: payment.status,
        payment: safePaymentStatus(payment, payment.attempts[0] ?? null),
        recovery: recoveryFor(payment.status, payment.attempts[0]?.status ?? null)
      };
    }
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
      recovery: recoveryFor(local.status, local.attempts[0]?.status ?? null),
      gateway: { orderStatus: order.order_status }
    };
  }

  async verifyPhonepePayment(paymentId: string, requestId?: string) {
    const local = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: paymentInclude()
    });
    if (!local) {
      throw paymentError(HttpStatus.NOT_FOUND, "PAYMENT_NOT_FOUND", "Payment not found.");
    }
    const transaction = await this.prisma.phonepeTransaction.findFirst({
      where: { paymentId: local.id },
      orderBy: { createdAt: "desc" }
    });
    if (!transaction) {
      throw paymentError(HttpStatus.BAD_REQUEST, "PHONEPE_TRANSACTION_MISSING", "Payment is missing a PhonePe transaction.");
    }

    const credentials = await this.paymentSettings.resolvePhonepeCredentials(local.order.storeId);
    const status = await this.phonepe.checkStatus(credentials, transaction.merchantTransactionId);
    const mapped = this.phonepe.normalizeStatus(status);
    const phonepeTransactionId = this.phonepe.gatewayPaymentIdFromStatus(status, transaction.merchantTransactionId);

    await this.prisma.phonepeTransaction.update({
      where: { id: transaction.id },
      data: {
        phonepeTransactionId: phonepeTransactionId || undefined,
        status: mapped,
        gatewayResponse: status as Prisma.InputJsonValue,
        ...(mapped === "PAID" ? { verifiedAt: new Date() } : {})
      }
    }).catch(() => undefined);

    if (mapped === "PAID") {
      return this.confirmPaid(local.id, {
        provider: PaymentProvider.PHONEPE,
        cashfreePaymentId: "",
        gatewayPaymentId: phonepeTransactionId,
        amountPaise: this.phonepe.amountPaiseFromStatus(status, local.amountPaise),
        currency: local.currency,
        gatewayOrder: status,
        gatewayPayment: status,
        requestId
      });
    }

    if (mapped === "FAILED" || mapped === "EXPIRED" || mapped === "USER_DROPPED") {
      return this.markGatewayFailure(local.id, mapped, status, requestId, PaymentProvider.PHONEPE);
    }

    return {
      apiVersion: "v1",
      status: "PENDING_GATEWAY",
      payment: safePaymentStatus(local, local.attempts[0] ?? null),
      recovery: recoveryFor(local.status, local.attempts[0]?.status ?? null),
      gateway: { orderStatus: mapped }
    };
  }

  async confirmPaid(paymentId: string, input: {
    cashfreePaymentId: string;
    gatewayPaymentId?: string;
    provider?: PaymentProvider;
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
    const gatewayProvider = input.provider ?? PaymentProvider.CASHFREE;
    const gatewayPaymentId = input.gatewayPaymentId ?? input.cashfreePaymentId;
    const localGatewayPaymentId = gatewayProvider === PaymentProvider.PHONEPE
      ? payment.phonepeTransactionId
      : payment.cashfreePaymentId;

    if (payment.status === PaymentStatus.PAID) {
      if (localGatewayPaymentId && gatewayPaymentId && localGatewayPaymentId !== gatewayPaymentId) {
        await this.createReconciliation(payment.id, ReconciliationReason.DUPLICATE_SUCCESS, "DUPLICATE_SUCCESS", {
          provider: gatewayProvider,
          existing: localGatewayPaymentId,
          incoming: gatewayPaymentId
        });
      }
      return {
        apiVersion: "v1",
        status: "PAID",
        payment: safePaymentStatus(payment, payment.attempts[0] ?? null),
        recovery: recoveryFor(payment.status, payment.attempts[0]?.status ?? null)
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

    if (
      payment.status === PaymentStatus.DUPLICATE_SUCCESS_REQUIRES_REFUND ||
      payment.status === PaymentStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW
    ) {
      return {
        apiVersion: "v1",
        status: payment.status,
        payment: safePaymentStatus(payment, payment.attempts[0] ?? null),
        recovery: recoveryFor(payment.status, payment.attempts[0]?.status ?? null)
      };
    }

    if (RELEASED_TERMINAL_SUCCESS_STATUSES.has(payment.status)) {
      return this.markLateSuccessRequiresRefund(payment, {
        ...input,
        gatewayPaymentId,
        provider: gatewayProvider
      });
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
      const inventoryResult = await this.inventory.confirmOrderStock(tx, {
        storeId: current.order.storeId,
        orderId: payment.orderId,
        idempotencyKey: gatewayPaymentId || `payment:${payment.id}`,
        requestId: input.requestId
      });
      if (inventoryResult.status === "REQUIRES_REVIEW") {
        await tx.paymentAttempt.updateMany({
          where: { paymentId: payment.id, status: { in: activeAttemptStatuses() } },
          data: {
            status: PaymentAttemptStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW,
            ...gatewayAttemptPaymentData(gatewayProvider, gatewayPaymentId),
            gatewayResponse: input.gatewayPayment as Prisma.InputJsonValue
          }
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            ...gatewayPaymentData(gatewayProvider, gatewayPaymentId),
            gatewayResponse: {
              order: input.gatewayOrder,
              payment: input.gatewayPayment,
              inventory: inventoryResult
            } as Prisma.InputJsonValue,
            verifiedAt: new Date()
          }
        });
        await this.transitions.transitionPayment(tx, {
          paymentId: payment.id,
          orderId: payment.orderId,
          attemptId: activeAttempt?.id,
          from: current.status,
          to: PaymentStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW,
          context: {
            reason: "inventory_confirmation_requires_review",
            requestId: input.requestId,
            metadata: inventoryResult as Prisma.InputJsonValue
          }
        });
        await tx.order.update({
          where: { id: payment.orderId },
          data: { paymentStatus: PaymentStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW }
        });
        await this.transitions.transitionOrder(tx, {
          orderId: payment.orderId,
          from: current.order.status,
          to: OrderStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW,
          context: {
            reason: "inventory_confirmation_requires_review",
            requestId: input.requestId,
            metadata: inventoryResult as Prisma.InputJsonValue
          }
        });
        await tx.reconciliationRun.create({
          data: {
            paymentId: payment.id,
            reason: ReconciliationReason.DUPLICATE_SUCCESS,
            driftCode: "INVENTORY_CONFIRMATION_REQUIRES_REVIEW",
            details: {
              orderId: payment.orderId,
              provider: gatewayProvider,
              [gatewayPaymentPayloadKey(gatewayProvider)]: gatewayPaymentId,
              inventory: inventoryResult
            } as Prisma.InputJsonObject,
            nextCheckAt: new Date()
          }
        });
        if (gatewayProvider === PaymentProvider.PHONEPE) {
          await tx.phonepeTransaction.updateMany({
            where: { paymentId: payment.id },
            data: {
              phonepeTransactionId: gatewayPaymentId || undefined,
              status: "COMPLETED",
              gatewayResponse: input.gatewayPayment as Prisma.InputJsonValue,
              verifiedAt: new Date()
            }
          });
        }
        return;
      }
      await tx.paymentAttempt.updateMany({
        where: { paymentId: payment.id, status: { in: activeAttemptStatuses() } },
        data: {
          status: PaymentAttemptStatus.PAID,
          ...gatewayAttemptPaymentData(gatewayProvider, gatewayPaymentId),
          gatewayResponse: input.gatewayPayment as Prisma.InputJsonValue
        }
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          ...gatewayPaymentData(gatewayProvider, gatewayPaymentId),
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
        context: { reason: `${providerLabel(gatewayProvider)}_paid_verified`, requestId: input.requestId }
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
          idempotencyKey: gatewayPaymentId || `${providerLabel(gatewayProvider)}:${payment.id}`,
          producer: "lotzi-api",
          payload: {
            orderId: payment.orderId,
            paymentId: payment.id,
            provider: gatewayProvider,
            [gatewayPaymentPayloadKey(gatewayProvider)]: gatewayPaymentId,
            amountPaise: input.amountPaise.toString()
          } as Prisma.InputJsonValue
        }
      });
      if (gatewayProvider === PaymentProvider.PHONEPE) {
        await tx.phonepeTransaction.updateMany({
          where: { paymentId: payment.id },
          data: {
            phonepeTransactionId: gatewayPaymentId || undefined,
            status: "COMPLETED",
            gatewayResponse: input.gatewayPayment as Prisma.InputJsonValue,
            verifiedAt: new Date()
          }
        });
      }
    }, PAYMENT_CONFIRM_TRANSACTION_OPTIONS);

    const updated = await this.prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: paymentInclude()
    });
    return {
      apiVersion: "v1",
      status: updated.status,
      payment: safePaymentStatus(updated, updated.attempts[0] ?? null),
      recovery: recoveryFor(updated.status, updated.attempts[0]?.status ?? null)
    };
  }

  async markGatewayFailure(
    paymentId: string,
    status: "FAILED" | "EXPIRED" | "USER_DROPPED",
    payload: unknown,
    requestId?: string,
    provider: PaymentProvider = PaymentProvider.CASHFREE
  ) {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: paymentInclude()
    });
    if (payment.status === PaymentStatus.PAID) {
      return {
        apiVersion: "v1",
        status: "PAID",
        payment: safePaymentStatus(payment, payment.attempts[0] ?? null),
        recovery: recoveryFor(payment.status, payment.attempts[0]?.status ?? null)
      };
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
        context: { reason: `${providerLabel(provider)}_${status.toLowerCase()}`, requestId, metadata: payload as Prisma.InputJsonValue }
      });
      if (nextPaymentStatus === PaymentStatus.FAILED || nextPaymentStatus === PaymentStatus.EXPIRED) {
        await this.inventory.releaseOrderStock(tx, {
          storeId: current.order.storeId,
          orderId: payment.orderId,
          reason: `payment_${nextPaymentStatus.toLowerCase()}`,
          idempotencyKey: `payment-release:${payment.id}:${nextPaymentStatus}`,
          requestId
        });
        await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: nextPaymentStatus } });
        await this.transitions.transitionOrder(tx, {
          orderId: payment.orderId,
          from: current.order.status,
          to: nextPaymentStatus === PaymentStatus.EXPIRED ? OrderStatus.EXPIRED : OrderStatus.PAYMENT_FAILED,
          context: { reason: `payment_${nextPaymentStatus.toLowerCase()}`, requestId }
        });
      }
      if (provider === PaymentProvider.PHONEPE) {
        await tx.phonepeTransaction.updateMany({
          where: { paymentId: payment.id },
          data: {
            status: nextPaymentStatus,
            gatewayResponse: payload as Prisma.InputJsonValue
          }
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
      payment: safePaymentStatus(updated, updated.attempts[0] ?? null),
      recovery: recoveryFor(updated.status, updated.attempts[0]?.status ?? null)
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
    if (payment.provider === PaymentProvider.PHONEPE) {
      return this.refundPhonepe(auth, payment, dto, amountPaise, requestId);
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

  private async refundPhonepe(
    auth: AuthenticatedPrincipal,
    payment: Awaited<ReturnType<PaymentsService["ownedPayment"]>>,
    dto: CreateRefundDto,
    amountPaise: bigint,
    requestId?: string
  ) {
    const transaction = await this.prisma.phonepeTransaction.findFirst({
      where: { paymentId: payment.id },
      orderBy: { createdAt: "desc" }
    });
    if (!transaction) {
      throw paymentError(HttpStatus.CONFLICT, "REFUND_GATEWAY_PAYMENT_MISSING", "PhonePe transaction is missing.");
    }

    const requestHash = this.idempotency.hash({ paymentId: payment.id, amountPaise: amountPaise.toString(), reason: dto.reason });
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
      const credentials = await this.paymentSettings.resolvePhonepeCredentials(payment.order.storeId);
      const gateway = await this.phonepe.refund({
        credentials,
        merchantRefundId: refundId,
        originalMerchantOrderId: transaction.merchantTransactionId,
        amountPaise
      });
      await this.prisma.$transaction(async (tx) => {
        const newRefunded = payment.refundedPaise + amountPaise;
        await tx.refund.update({
          where: { id: created.id },
          data: {
            status: RefundStatus.SUCCESS,
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
            payload: { refundId, amountPaise: amountPaise.toString(), provider: "PHONEPE", gateway } as Prisma.InputJsonValue
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

  private async preparePhonepeRetryAttempt(
    payment: Awaited<ReturnType<PaymentsService["ownedPayment"]>>,
    idempotencyKey: string,
    requestId?: string
  ) {
    const attemptNumber = (await this.prisma.paymentAttempt.count({ where: { paymentId: payment.id } })) + 1;
    const attemptId = randomUUID();
    const merchantOrderId = `nma_pp_${payment.orderId.replace(/-/g, "").slice(0, 24)}_${attemptNumber}`;
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
          amountPaise: payment.amountPaise,
          currency: payment.currency,
          idempotencyKey,
          expiresAt,
          gatewayRequest: { retry: true, provider: "PHONEPE", previousStatus: payment.status } as Prisma.InputJsonValue
        }
      });
      await tx.phonepeTransaction.create({
        data: {
          paymentId: payment.id,
          orderId: payment.orderId,
          storeId: payment.order.storeId,
          merchantTransactionId: merchantOrderId,
          amountPaise: payment.amountPaise,
          currency: payment.currency,
          status: "INITIATED",
          gatewayRequest: { retry: true, attemptId } as Prisma.InputJsonValue
        }
      });
      if (payment.status !== PaymentStatus.PENDING_GATEWAY) {
        await this.transitions.transitionPayment(tx, {
          paymentId: payment.id,
          orderId: payment.orderId,
          attemptId,
          from: payment.status,
          to: PaymentStatus.PENDING_GATEWAY,
          context: { reason: "phonepe_retry_started", requestId }
        });
      }
    });
    return { attemptId, merchantOrderId };
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

  private async markPhonepeRetrySessionCreated(
    payment: Awaited<ReturnType<PaymentsService["ownedPayment"]>>,
    attemptId: string,
    merchantOrderId: string,
    gateway: Record<string, unknown>,
    redirectUrl: string,
    requestId?: string
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentAttempt.update({
        where: { id: attemptId },
        data: {
          status: PaymentAttemptStatus.PENDING_GATEWAY,
          gatewayResponse: gateway as Prisma.InputJsonValue
        }
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          gatewayProvider: PaymentProvider.PHONEPE,
          gatewayResponse: gateway as Prisma.InputJsonValue
        }
      });
      await tx.phonepeTransaction.updateMany({
        where: { paymentId: payment.id, merchantTransactionId: merchantOrderId },
        data: {
          status: "INITIATED",
          redirectUrl,
          gatewayResponse: gateway as Prisma.InputJsonValue
        }
      });
      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          orderId: payment.orderId,
          attemptId,
          eventType: "payment.retry.session.created",
          fromStatus: PaymentStatus.PENDING_GATEWAY,
          toStatus: PaymentStatus.PENDING_GATEWAY,
          reason: "phonepe_retry_session_created",
          requestId,
          payload: {
            merchantOrderId,
            gateway
          } as Prisma.InputJsonValue
        }
      });
    });

    return {
      apiVersion: "v1",
      status: "SESSION_CREATED",
      provider: "phonepe",
      paymentId: payment.id,
      orderId: payment.orderId,
      attemptId,
      merchantOrderId,
      redirectUrl,
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

  private async markLateSuccessRequiresRefund(
    payment: Awaited<ReturnType<PaymentsService["ownedPayment"]>>,
    input: {
      cashfreePaymentId: string;
      gatewayPaymentId?: string;
      provider?: PaymentProvider;
      amountPaise: bigint;
      currency: string;
      gatewayOrder: unknown;
      gatewayPayment: unknown;
      requestId?: string;
    }
  ) {
    const gatewayProvider = input.provider ?? PaymentProvider.CASHFREE;
    const gatewayPaymentId = input.gatewayPaymentId ?? input.cashfreePaymentId;
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: { order: true, attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } }
      });
      if (current.status === PaymentStatus.PAID || current.status === PaymentStatus.DUPLICATE_SUCCESS_REQUIRES_REFUND) {
        return;
      }
      if (!RELEASED_TERMINAL_SUCCESS_STATUSES.has(current.status)) {
        return;
      }
      const activeAttempt = current.attempts[0];
      await tx.paymentAttempt.updateMany({
        where: { paymentId: payment.id },
        data: {
          status: PaymentAttemptStatus.DUPLICATE_SUCCESS_REQUIRES_REFUND,
          ...gatewayAttemptPaymentData(gatewayProvider, gatewayPaymentId),
          gatewayResponse: input.gatewayPayment as Prisma.InputJsonValue
        }
      });
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          ...gatewayPaymentData(gatewayProvider, gatewayPaymentId),
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
        to: PaymentStatus.DUPLICATE_SUCCESS_REQUIRES_REFUND,
        context: {
          reason: "late_gateway_success_after_released_terminal_state",
          requestId: input.requestId,
          metadata: {
            previousPaymentStatus: current.status,
            orderStatus: current.order.status,
            provider: gatewayProvider,
            [gatewayPaymentPayloadKey(gatewayProvider)]: gatewayPaymentId || null
          } as Prisma.InputJsonObject
        }
      });
      await tx.order.update({
        where: { id: payment.orderId },
        data: { paymentStatus: PaymentStatus.DUPLICATE_SUCCESS_REQUIRES_REFUND }
      });
      await tx.reconciliationRun.create({
        data: {
          paymentId: payment.id,
          reason: ReconciliationReason.DUPLICATE_SUCCESS,
          driftCode: "LATE_SUCCESS_AFTER_RELEASED_TERMINAL_STATE",
          details: {
            previousPaymentStatus: current.status,
            orderStatus: current.order.status,
            provider: gatewayProvider,
            [gatewayPaymentPayloadKey(gatewayProvider)]: gatewayPaymentId || null,
            amountPaise: input.amountPaise.toString()
          } as Prisma.InputJsonObject,
          nextCheckAt: new Date()
        }
      });
      if (gatewayProvider === PaymentProvider.PHONEPE) {
        await tx.phonepeTransaction.updateMany({
          where: { paymentId: payment.id },
          data: {
            phonepeTransactionId: gatewayPaymentId || undefined,
            status: "COMPLETED_REQUIRES_REFUND",
            gatewayResponse: input.gatewayPayment as Prisma.InputJsonValue,
            verifiedAt: new Date()
          }
        });
      }
    }, PAYMENT_CONFIRM_TRANSACTION_OPTIONS);

    const updated = await this.prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
      include: paymentInclude()
    });
    return {
      apiVersion: "v1",
      status: updated.status,
      payment: safePaymentStatus(updated, updated.attempts[0] ?? null),
      recovery: recoveryFor(updated.status, updated.attempts[0]?.status ?? null)
    };
  }
}

function paymentInclude() {
  return {
    order: { include: { user: true } },
    attempts: { orderBy: { attemptNumber: "desc" as const }, take: 1 }
  };
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
  if (normalized === "SUCCESS" || normalized === "PAID" || normalized === "AUTHORIZED") return "PAID";
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
  if (status === PaymentStatus.AUTHORIZED) return { action: "TRACK_ORDER", pollAfterMs: null };
  if (status === PaymentStatus.UNKNOWN_GATEWAY) return { action: "WAIT_RECONCILIATION", pollAfterMs: 15_000 };
  if (status === PaymentStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW) return { action: "CONTACT_SUPPORT", pollAfterMs: null };
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
    method: PaymentMethod;
    provider: PaymentProvider;
    status: PaymentStatus;
    amountPaise: bigint;
    currency: string;
    cashfreeOrderId: string | null;
    cashfreePaymentId: string | null;
    phonepeTransactionId: string | null;
    gatewayProvider: string | null;
    verifiedAt: Date | null;
    order: { id: string; status: OrderStatus; paymentStatus: PaymentStatus; grandTotalPaise: bigint; expiresAt: Date | null };
  },
  attempt: { id: string; attemptNumber: number; status: PaymentAttemptStatus; expiresAt: Date | null } | null
) {
  return {
    id: payment.id,
    orderId: payment.orderId,
    method: payment.method,
    provider: payment.provider,
    status: payment.status,
    orderStatus: payment.order.status,
    paymentStatus: payment.order.paymentStatus,
    amountPaise: payment.amountPaise.toString(),
    amount: paiseToNumber(payment.amountPaise),
    currency: payment.currency,
    cashfreeOrderId: payment.cashfreeOrderId,
    cashfreePaymentId: payment.cashfreePaymentId,
    phonepeTransactionId: payment.phonepeTransactionId,
    gatewayProvider: payment.gatewayProvider,
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

function gatewayPaymentData(provider: PaymentProvider, gatewayPaymentId: string | null | undefined) {
  if (provider === PaymentProvider.PHONEPE) {
    return {
      phonepeTransactionId: gatewayPaymentId || undefined,
      gatewayProvider: PaymentProvider.PHONEPE
    };
  }
  if (provider === PaymentProvider.COD) {
    return {
      gatewayProvider: PaymentProvider.COD
    };
  }
  return {
    cashfreePaymentId: gatewayPaymentId || undefined,
    gatewayProvider: PaymentProvider.CASHFREE
  };
}

function gatewayAttemptPaymentData(provider: PaymentProvider, gatewayPaymentId: string | null | undefined) {
  if (provider !== PaymentProvider.CASHFREE) {
    return {};
  }
  return { cashfreePaymentId: gatewayPaymentId || undefined };
}

function gatewayPaymentPayloadKey(provider: PaymentProvider) {
  if (provider === PaymentProvider.PHONEPE) return "phonepeTransactionId";
  if (provider === PaymentProvider.COD) return "codReferenceId";
  return "cashfreePaymentId";
}

function providerLabel(provider: PaymentProvider) {
  return provider.toLowerCase();
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
  if (error instanceof PhonepeGatewayError) {
    return {
      code: "PHONEPE_GATEWAY_ERROR",
      message: error.message,
      retryable: error.retryable,
      status: error.status ?? null,
      timedOut: error.timedOut,
      responseBody: (error.responseBody ?? null) as Prisma.InputJsonValue
    };
  }
  return { code: "PAYMENT_ERROR", message: error instanceof Error ? error.message : String(error) };
}
