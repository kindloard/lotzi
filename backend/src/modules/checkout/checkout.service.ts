import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  OrderStatus,
  PaymentAttemptStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  ProductStatus,
  ReconciliationReason
} from "@prisma/client";
import { randomUUID, createHash } from "node:crypto";
import { CashfreeClient, CashfreeGatewayError } from "../../integrations/cashfree/cashfree.client";
import { PrismaService } from "../../database/prisma.service";
import { AuthenticatedPrincipal } from "../auth/auth.types";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { InventoryService } from "../inventory/inventory.service";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import { CreateCheckoutSessionDto } from "./dto/checkout.dto";
import { paymentError } from "../payments/payment.errors";
import { PaymentTransitionService } from "../payments/payment-transition.service";
import {
  GST_BASIS_POINTS,
  INR,
  bigintJson,
  decimalRupeesToPaise,
  paiseToNumber,
  paiseToRupeeDecimal,
  percentBasisPoints,
  quoteHash
} from "../payments/money";

const CHECKOUT_TTL_MS = 15 * 60 * 1000;
const CHECKOUT_MAX_LINES = 50;
const PRICING_VERSION = 1;

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashfree: CashfreeClient,
    private readonly config: ConfigService,
    private readonly idempotency: IdempotencyService,
    private readonly inventory: InventoryService,
    private readonly rateLimit: RateLimitService,
    private readonly transitions: PaymentTransitionService
  ) {}

  async createSession(auth: AuthenticatedPrincipal, dto: CreateCheckoutSessionDto, requestId?: string) {
    await this.rateLimit.enforce(`checkout:create:${auth.userId}`, 12, 60);

    const normalized = normalizeCheckout(dto);
    const requestHash = this.idempotency.hash({ ...normalized, idempotencyKey: undefined });
    const reservation = await this.idempotency.reserve({
      key: normalized.idempotencyKey,
      userId: auth.userId,
      operation: "checkout.session.create.v1",
      requestHash,
      ttlMs: 7 * 24 * 60 * 60 * 1000
    });
    if (reservation.state === "replayed") {
      return reservation.response;
    }

    try {
      const prepared = await this.prepareLocalCheckout(auth, normalized, requestHash, requestId);
      const cashfreeOrder = await this.cashfree.createOrder({
        cashfreeOrderId: prepared.cashfreeOrderId,
        amountPaise: prepared.grandTotalPaise,
        currency: INR,
        customer: prepared.customer,
        returnUrl: this.returnUrl(prepared.orderId, prepared.paymentId),
        notifyUrl: this.notifyUrl(),
        idempotencyKey: prepared.attemptId,
        metadata: {
          orderId: prepared.orderId,
          paymentId: prepared.paymentId,
          attemptId: prepared.attemptId
        }
      });

      if (!cashfreeOrder.payment_session_id) {
        throw new CashfreeGatewayError("Cashfree did not return a payment session.", true, 502, cashfreeOrder);
      }

      const response = await this.markSessionCreated(prepared, cashfreeOrder, requestId);
      await this.idempotency.complete(reservation, response);
      return response;
    } catch (error) {
      const handled = await this.handleCheckoutCreationError(error, normalized.idempotencyKey, requestId);
      if (handled) {
        await this.idempotency.complete(reservation, handled);
        return handled;
      }
      await this.idempotency.fail(reservation, errorBody(error));
      throw error;
    }
  }

  private async prepareLocalCheckout(
    auth: AuthenticatedPrincipal,
    dto: ReturnType<typeof normalizeCheckout>,
    requestHash: string,
    requestId?: string
  ) {
    const productRows = await this.loadProducts(dto.items.map((item) => item.variantId));
    if (productRows.length !== dto.items.length) {
      throw paymentError(HttpStatus.CONFLICT, "CHECKOUT_PRODUCT_UNAVAILABLE", "One or more products are no longer available.");
    }

    const rowsByVariant = new Map(productRows.map((row) => [row.id, row]));
    const storeIds = new Set(productRows.map((row) => row.product.storeId));
    if (storeIds.size !== 1) {
      throw paymentError(HttpStatus.BAD_REQUEST, "CHECKOUT_SINGLE_STORE_REQUIRED", "Checkout currently supports one store at a time.");
    }
    const storeId = productRows[0]!.product.storeId;
    const store = productRows[0]!.product.store;
    if (store.status !== "APPROVED" || store.deletedAt) {
      throw paymentError(HttpStatus.CONFLICT, "CHECKOUT_STORE_UNAVAILABLE", "This store is not accepting orders.");
    }

    const address = dto.addressId
      ? await this.prisma.address.findFirst({ where: { id: dto.addressId, userId: auth.userId, deletedAt: null } })
      : await this.prisma.address.findFirst({ where: { userId: auth.userId, deletedAt: null, isDefault: true } });
    if (!address && store.isDeliveryAvailable) {
      throw paymentError(HttpStatus.BAD_REQUEST, "CHECKOUT_ADDRESS_REQUIRED", "Choose a delivery address before checkout.");
    }

    const customer = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      select: { id: true, email: true, fullName: true, phone: true }
    });

    const items = dto.items.map((item) => {
      const variant = rowsByVariant.get(item.variantId);
      if (!variant || variant.productId !== item.productId || variant.product.status !== ProductStatus.PUBLISHED || !variant.product.isActive) {
        throw paymentError(HttpStatus.CONFLICT, "CHECKOUT_PRODUCT_UNAVAILABLE", "One or more products are no longer available.");
      }
      const unitPricePaise = decimalRupeesToPaise(variant.price);
      return {
        productId: variant.productId,
        variantId: variant.id,
        name: variant.product.name,
        variantName: variant.name,
        unitDisplay: unitDisplay(variant),
        quantityValue: variant.quantityValue,
        quantityUnit: variant.quantityUnit,
        packType: variant.packType,
        quantity: item.quantity,
        unitPricePaise,
        mrp: variant.mrp,
        lineSubtotalPaise: unitPricePaise * BigInt(item.quantity)
      };
    });

    await this.inventory.admitCheckout({
      storeId,
      items: items.map((item) => ({ productVariantId: item.variantId }))
    });

    const subtotalPaise = items.reduce((total, item) => total + item.lineSubtotalPaise, 0n);
    const discountPaise = discountFor(dto.couponCode, subtotalPaise);
    const lineDiscounts = allocateByLargestRemainder(discountPaise, items.map((item) => item.lineSubtotalPaise));
    const taxPaise = items.reduce((total, item, index) => {
      const discounted = item.lineSubtotalPaise - lineDiscounts[index]!;
      return total + percentBasisPoints(discounted, GST_BASIS_POINTS);
    }, 0n);
    const deliveryFeePaise = dto.shippingOption === "priority" ? 4_900n : 0n;
    const grandTotalPaise = subtotalPaise - discountPaise + taxPaise + deliveryFeePaise;
    if (grandTotalPaise <= 0n) {
      throw paymentError(HttpStatus.BAD_REQUEST, "CHECKOUT_TOTAL_INVALID", "Checkout total must be greater than zero.");
    }

    const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MS);
    const quotePayload = {
      userId: auth.userId,
      storeId,
      addressId: address?.id ?? null,
      currency: INR,
      pricingVersion: PRICING_VERSION,
      items: items.map((item, index) => ({
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPricePaise: bigintJson(item.unitPricePaise),
        discountPaise: bigintJson(lineDiscounts[index]!),
        taxBasisPoints: GST_BASIS_POINTS
      })),
      subtotalPaise: bigintJson(subtotalPaise),
      discountPaise: bigintJson(discountPaise),
      taxPaise: bigintJson(taxPaise),
      deliveryFeePaise: bigintJson(deliveryFeePaise),
      grandTotalPaise: bigintJson(grandTotalPaise)
    };
    const hash = quoteHash(quotePayload);
    const paymentId = randomUUID();
    const orderId = randomUUID();
    const attemptId = randomUUID();
    const checkoutSessionId = randomUUID();
    const cashfreeOrderId = `nma_${orderId}`;

    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          id: orderId,
          userId: auth.userId,
          storeId,
          addressId: address?.id,
          addressRecipientName: address?.recipientName,
          addressRecipientPhone: address?.recipientPhone,
          addressLine1: address?.line1,
          addressLine2: address?.line2,
          addressCity: address?.city,
          addressState: address?.state,
          addressPincode: address?.pincode,
          addressLatitude: address?.latitude,
          addressLongitude: address?.longitude,
          status: OrderStatus.PENDING_PAYMENT,
          paymentMethod: PaymentMethod.CASHFREE,
          paymentStatus: PaymentStatus.INITIATED,
          subtotal: paiseToRupeeDecimal(subtotalPaise),
          deliveryFee: paiseToRupeeDecimal(deliveryFeePaise),
          total: paiseToRupeeDecimal(grandTotalPaise),
          currency: INR,
          pricingVersion: PRICING_VERSION,
          quoteHash: hash,
          subtotalPaise,
          discountPaise,
          taxPaise,
          deliveryFeePaise,
          grandTotalPaise,
          expiresAt,
          customerNote: null
        }
      });

      await tx.orderItem.createMany({
        data: items.map((item, index) => {
          const itemDiscount = lineDiscounts[index]!;
          const itemTax = percentBasisPoints(item.lineSubtotalPaise - itemDiscount, GST_BASIS_POINTS);
          return {
            orderId: order.id,
            productId: item.productId,
            variantId: item.variantId,
            name: item.name,
            variantName: item.variantName,
            unitDisplay: item.unitDisplay,
            quantityValue: item.quantityValue,
            quantityUnit: item.quantityUnit,
            packType: item.packType,
            quantity: item.quantity,
            unitPrice: paiseToRupeeDecimal(item.unitPricePaise),
            mrp: item.mrp,
            total: paiseToRupeeDecimal(item.lineSubtotalPaise - itemDiscount + itemTax),
            unitPricePaise: item.unitPricePaise,
            discountPaise: itemDiscount,
            taxPaise: itemTax,
            totalPaise: item.lineSubtotalPaise - itemDiscount + itemTax
          };
        })
      });

      await tx.payment.create({
        data: {
          id: paymentId,
          orderId: order.id,
          method: PaymentMethod.CASHFREE,
          provider: PaymentProvider.CASHFREE,
          status: PaymentStatus.INITIATED,
          amount: paiseToRupeeDecimal(grandTotalPaise),
          amountPaise: grandTotalPaise,
          currency: INR,
          idempotencyKey: dto.idempotencyKey,
          cashfreeOrderId,
          gatewayResponse: {}
        }
      });

      await tx.paymentAttempt.create({
        data: {
          id: attemptId,
          orderId: order.id,
          paymentId,
          attemptNumber: 1,
          status: PaymentAttemptStatus.INITIATED,
          cashfreeOrderId,
          amountPaise: grandTotalPaise,
          currency: INR,
          idempotencyKey: attemptId,
          expiresAt,
          gatewayRequest: quotePayload as Prisma.InputJsonValue
        }
      });

      await tx.checkoutSession.create({
        data: {
          id: checkoutSessionId,
          userId: auth.userId,
          storeId,
          orderId: order.id,
          idempotencyKey: dto.idempotencyKey,
          requestHash,
          quoteHash: hash,
          currency: INR,
          subtotalPaise,
          discountPaise,
          taxPaise,
          deliveryFeePaise,
          grandTotalPaise,
          expiresAt,
          payload: quotePayload as Prisma.InputJsonValue
        }
      });

      await this.inventory.reserveOrderStock(tx, {
        storeId,
        userId: auth.userId,
        orderId: order.id,
        expiresAt,
        idempotencyKey: dto.idempotencyKey,
        requestId,
        items: items.map((item) => ({
          productVariantId: item.variantId,
          quantity: item.quantity
        }))
      });

      await tx.paymentEvent.create({
        data: {
          paymentId,
          orderId: order.id,
          attemptId,
          eventType: "payment.initiated",
          fromStatus: null,
          toStatus: PaymentStatus.INITIATED,
          actorType: "CUSTOMER",
          actorUserId: auth.userId,
          reason: "checkout_created",
          requestId,
          payload: quotePayload as Prisma.InputJsonValue
        }
      });

      await tx.orderStateTransition.create({
        data: {
          orderId: order.id,
          fromStatus: OrderStatus.PENDING,
          toStatus: OrderStatus.PENDING_PAYMENT,
          actorType: "CUSTOMER",
          actorUserId: auth.userId,
          reason: "checkout_created",
          requestId,
          metadata: { checkoutSessionId } as Prisma.InputJsonValue
        }
      });
    });

    return {
      orderId,
      paymentId,
      attemptId,
      checkoutSessionId,
      cashfreeOrderId,
      grandTotalPaise,
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.fullName,
        phone: address?.recipientPhone ?? customer.phone
      },
      responseTotals: totalsResponse({ subtotalPaise, discountPaise, taxPaise, deliveryFeePaise, grandTotalPaise })
    };
  }

  private async markSessionCreated(
    prepared: Awaited<ReturnType<CheckoutService["prepareLocalCheckout"]>>,
    cashfreeOrder: Record<string, unknown>,
    requestId?: string
  ) {
    const paymentSessionId = String(cashfreeOrder.payment_session_id);
    const sessionHash = createHash("sha256").update(paymentSessionId).digest("hex");
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: prepared.paymentId } });
      await tx.paymentAttempt.update({
        where: { id: prepared.attemptId },
        data: {
          status: PaymentAttemptStatus.PENDING_GATEWAY,
          cashfreeCfOrderId: stringOrNull(cashfreeOrder.cf_order_id),
          paymentSessionIdHash: sessionHash,
          gatewayResponse: cashfreeOrder as Prisma.InputJsonValue
        }
      });
      await tx.payment.update({
        where: { id: prepared.paymentId },
        data: {
          cashfreeCfOrderId: stringOrNull(cashfreeOrder.cf_order_id),
          gatewayResponse: cashfreeOrder as Prisma.InputJsonValue
        }
      });
      await this.transitions.transitionPayment(tx, {
        paymentId: prepared.paymentId,
        orderId: prepared.orderId,
        attemptId: prepared.attemptId,
        from: payment.status,
        to: PaymentStatus.SESSION_CREATED,
        context: { reason: "cashfree_session_created", requestId }
      });
      await this.transitions.transitionPayment(tx, {
        paymentId: prepared.paymentId,
        orderId: prepared.orderId,
        attemptId: prepared.attemptId,
        from: PaymentStatus.SESSION_CREATED,
        to: PaymentStatus.PENDING_GATEWAY,
        context: { reason: "cashfree_session_ready", requestId }
      });
      await tx.domainEvent.create({
        data: {
          schemaVersion: 1,
          eventType: "payment.session.created",
          aggregateType: "payment",
          aggregateId: prepared.paymentId,
          idempotencyKey: prepared.attemptId,
          producer: "namastore-api",
          payload: {
            orderId: prepared.orderId,
            paymentId: prepared.paymentId,
            attemptId: prepared.attemptId,
            cashfreeOrderId: prepared.cashfreeOrderId
          } as Prisma.InputJsonValue
        }
      });
    });

    return {
      apiVersion: "v1",
      status: "SESSION_CREATED",
      orderId: prepared.orderId,
      paymentId: prepared.paymentId,
      attemptId: prepared.attemptId,
      cashfreeOrderId: prepared.cashfreeOrderId,
      paymentSessionId,
      totals: prepared.responseTotals,
      expiresAt: new Date(Date.now() + CHECKOUT_TTL_MS).toISOString()
    };
  }

  private async handleCheckoutCreationError(error: unknown, idempotencyKey: string, requestId?: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { idempotencyKey },
      include: { order: true, attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } }
    });
    if (!payment) {
      return null;
    }

    const gatewayError = error instanceof CashfreeGatewayError ? error : null;
    const retryableUnknown = Boolean(gatewayError?.retryable || gatewayError?.timedOut);
    if (!retryableUnknown) {
      await this.prisma.$transaction(async (tx) => {
        await this.inventory.releaseOrderStock(tx, {
          storeId: payment.order.storeId,
          orderId: payment.orderId,
          reason: "cashfree_create_failed",
          idempotencyKey: `checkout-create-failed:${payment.id}`,
          requestId
        });
        await tx.paymentAttempt.updateMany({
          where: { paymentId: payment.id, status: { in: [PaymentAttemptStatus.INITIATED, PaymentAttemptStatus.SESSION_CREATED] } },
          data: { status: PaymentAttemptStatus.FAILED, gatewayResponse: errorBody(error) as Prisma.InputJsonValue }
        });
        await this.transitions.transitionPayment(tx, {
          paymentId: payment.id,
          orderId: payment.orderId,
          attemptId: payment.attempts[0]?.id,
          from: payment.status,
          to: PaymentStatus.FAILED,
          context: { reason: "cashfree_create_failed", requestId, metadata: errorBody(error) as Prisma.InputJsonValue }
        });
        await this.transitions.transitionOrder(tx, {
          orderId: payment.orderId,
          from: payment.order.status,
          to: OrderStatus.PAYMENT_FAILED,
          context: { reason: "cashfree_create_failed", requestId }
        });
      });
      return null;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentAttempt.updateMany({
        where: { paymentId: payment.id, status: { in: [PaymentAttemptStatus.INITIATED, PaymentAttemptStatus.SESSION_CREATED] } },
        data: { status: PaymentAttemptStatus.UNKNOWN_GATEWAY, gatewayResponse: errorBody(error) as Prisma.InputJsonValue }
      });
      await this.transitions.transitionPayment(tx, {
        paymentId: payment.id,
        orderId: payment.orderId,
        attemptId: payment.attempts[0]?.id,
        from: payment.status,
        to: PaymentStatus.UNKNOWN_GATEWAY,
        context: { reason: "cashfree_create_unknown", requestId, metadata: errorBody(error) as Prisma.InputJsonValue }
      });
      await tx.reconciliationRun.create({
        data: {
          paymentId: payment.id,
          reason: ReconciliationReason.UNKNOWN_GATEWAY,
          details: errorBody(error) as Prisma.InputJsonValue,
          nextCheckAt: new Date(Date.now() + 60_000)
        }
      });
    });
    this.logger.warn(`Checkout moved to UNKNOWN_GATEWAY for payment ${payment.id}.`);
    return {
      apiVersion: "v1",
      status: "UNKNOWN_GATEWAY",
      orderId: payment.orderId,
      paymentId: payment.id,
      retryAfterSeconds: 60,
      message: "Payment session is being reconciled. Please check status shortly."
    };
  }

  private async loadProducts(variantIds: string[]) {
    return this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: {
        product: {
          include: {
            store: true
          }
        }
      }
    });
  }

  private returnUrl(orderId: string, paymentId: string) {
    const configured = this.config.get<string>("CASHFREE_RETURN_URL");
    if (configured) {
      const url = new URL(configured);
      url.searchParams.set("orderId", orderId);
      url.searchParams.set("paymentId", paymentId);
      return url.toString();
    }
    return `${this.config.get<string>("FRONTEND_URL", "http://localhost:3000")}/en/checkout/status?orderId=${orderId}&paymentId=${paymentId}`;
  }

  private notifyUrl() {
    return this.config.get<string>("CASHFREE_NOTIFY_URL");
  }
}

function normalizeCheckout(dto: CreateCheckoutSessionDto) {
  const aggregated = new Map<string, { productId: string; variantId: string; quantity: number }>();
  for (const item of dto.items) {
    const key = item.variantId;
    const existing = aggregated.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      aggregated.set(key, {
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity
      });
    }
  }
  const items = Array.from(aggregated.values()).sort((a, b) => a.variantId.localeCompare(b.variantId));
  if (items.length > CHECKOUT_MAX_LINES) {
    throw paymentError(
      HttpStatus.BAD_REQUEST,
      "CHECKOUT_CART_TOO_LARGE",
      `Checkout supports up to ${CHECKOUT_MAX_LINES} distinct items.`,
      false,
      { maxLines: CHECKOUT_MAX_LINES, lineCount: items.length }
    );
  }
  return {
    ...dto,
    shippingOption: dto.shippingOption ?? "standard",
    couponCode: dto.couponCode?.trim().toUpperCase() || undefined,
    idempotencyKey: dto.idempotencyKey.trim(),
    items
  };
}

function discountFor(couponCode: string | undefined, subtotalPaise: bigint) {
  if (!couponCode) {
    return 0n;
  }
  if (couponCode === "WELCOME10") {
    return percentBasisPoints(subtotalPaise, 1_000);
  }
  if (couponCode === "LOCAL5") {
    return percentBasisPoints(subtotalPaise, 500);
  }
  throw paymentError(HttpStatus.BAD_REQUEST, "CHECKOUT_COUPON_INVALID", "This coupon is not available.");
}

function allocateByLargestRemainder(total: bigint, weights: bigint[]) {
  if (total === 0n) {
    return weights.map(() => 0n);
  }
  const sum = weights.reduce((acc, value) => acc + value, 0n);
  if (sum <= 0n) {
    return weights.map(() => 0n);
  }
  const rows = weights.map((weight, index) => {
    const numerator = total * weight;
    return {
      index,
      base: numerator / sum,
      remainder: numerator % sum
    };
  });
  let allocated = rows.reduce((acc, row) => acc + row.base, 0n);
  const output = rows.map((row) => row.base);
  for (const row of rows.sort((a, b) => Number(b.remainder - a.remainder))) {
    if (allocated >= total) {
      break;
    }
    output[row.index] += 1n;
    allocated += 1n;
  }
  return output;
}

function totalsResponse(input: {
  subtotalPaise: bigint;
  discountPaise: bigint;
  taxPaise: bigint;
  deliveryFeePaise: bigint;
  grandTotalPaise: bigint;
}) {
  return {
    currency: INR,
    subtotalPaise: input.subtotalPaise.toString(),
    discountPaise: input.discountPaise.toString(),
    taxPaise: input.taxPaise.toString(),
    deliveryFeePaise: input.deliveryFeePaise.toString(),
    grandTotalPaise: input.grandTotalPaise.toString(),
    subtotal: paiseToNumber(input.subtotalPaise),
    discount: paiseToNumber(input.discountPaise),
    tax: paiseToNumber(input.taxPaise),
    deliveryFee: paiseToNumber(input.deliveryFeePaise),
    grandTotal: paiseToNumber(input.grandTotalPaise)
  };
}

function unitDisplay(variant: {
  quantityValue: Prisma.Decimal;
  quantityUnit: string;
  packType: string;
}) {
  const quantity = Number(variant.quantityValue);
  const formatted = Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
  return `${formatted} ${variant.quantityUnit.toLowerCase()} ${variant.packType.toLowerCase()}`;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function errorBody(error: unknown): Prisma.InputJsonObject {
  if (error instanceof CashfreeGatewayError) {
    return {
      code: "CASHFREE_GATEWAY_ERROR",
      message: error.message,
      retryable: error.retryable,
      status: error.status ?? null,
      timedOut: error.timedOut,
      responseBody: (error.responseBody ?? null) as Prisma.InputJsonValue
    };
  }
  if (error && typeof error === "object" && "response" in error) {
    return { code: "CHECKOUT_ERROR", response: (error as { response?: unknown }).response as Prisma.InputJsonValue };
  }
  return { code: "CHECKOUT_ERROR", message: error instanceof Error ? error.message : String(error) };
}
