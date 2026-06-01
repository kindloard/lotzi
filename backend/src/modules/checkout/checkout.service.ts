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
import type { RequestTimer } from "../../common/request-timing";
import { CashfreeClient, CashfreeGatewayError } from "../../integrations/cashfree/cashfree.client";
import { PhonepeClient, PhonepeGatewayError } from "../../integrations/phonepe/phonepe.client";
import { PrismaService } from "../../database/prisma.service";
import { AuthenticatedPrincipal } from "../auth/auth.types";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { InventoryService } from "../inventory/inventory.service";
import { PaymentSettingsService } from "../payment-settings/payment-settings.service";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import { CreateCheckoutSessionDto } from "./dto/checkout.dto";
import { paymentError } from "../payments/payment.errors";
import { PaymentTransitionService } from "../payments/payment-transition.service";
import { updateCheckoutTraceContext } from "./checkout-tracing";
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
const CHECKOUT_CONFIRM_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;
type CheckoutMethodKey = NonNullable<CreateCheckoutSessionDto["paymentMethod"]>;
type StoreOwnedCheckoutMethodKey = Exclude<CheckoutMethodKey, "cashfree">;
type CheckoutMethodOption = {
  key: StoreOwnedCheckoutMethodKey;
  name: string;
  enabled: true;
  priority: number;
};
type CheckoutPaymentIntent = {
  storeId: string;
  methodKey: StoreOwnedCheckoutMethodKey;
  provider: PaymentProvider;
};
type CheckoutProductRow = Prisma.ProductVariantGetPayload<{
  select: {
    id: true;
    productId: true;
    name: true;
    price: true;
    mrp: true;
    quantityValue: true;
    quantityUnit: true;
    packType: true;
    product: {
      select: {
        id: true;
        storeId: true;
        name: true;
        status: true;
        isActive: true;
        store: {
          select: {
            id: true;
            status: true;
            deletedAt: true;
            isDeliveryAvailable: true;
          };
        };
      };
    };
  };
}>;
type CheckoutAddressRow = {
  id: string;
  recipientName: string | null;
  recipientPhone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
};
type CheckoutCustomerRow = {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
};
type CheckoutQuoteItem = {
  productId: string;
  variantId: string;
  name: string;
  variantName: string | null;
  unitDisplay: string;
  quantityValue: Prisma.Decimal;
  quantityUnit: string;
  packType: string;
  quantity: number;
  unitPricePaise: bigint;
  mrp: Prisma.Decimal | null;
  lineSubtotalPaise: bigint;
};
type CodCheckoutWriteResult = {
  lockedCount: number | bigint;
  availableCount: number | bigint;
  orderInserted: number | bigint;
  reservationCount: number | bigint;
};
type CheckoutCustomerAddress = {
  address: CheckoutAddressRow | null;
  customer: CheckoutCustomerRow;
};

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashfree: CashfreeClient,
    private readonly phonepe: PhonepeClient,
    private readonly config: ConfigService,
    private readonly idempotency: IdempotencyService,
    private readonly inventory: InventoryService,
    private readonly paymentSettings: PaymentSettingsService,
    private readonly rateLimit: RateLimitService,
    private readonly transitions: PaymentTransitionService
  ) {}

  async createSession(
    auth: AuthenticatedPrincipal,
    dto: CreateCheckoutSessionDto,
    requestId?: string,
    timer?: RequestTimer
  ) {
    await timeStage(timer, "rate_limit", () => this.rateLimit.enforce(`checkout:create:${auth.userId}`, 12, 60));

    const normalized = normalizeCheckout(dto);
    updateCheckoutTraceContext({
      cartLineCount: normalized.items.length,
      paymentMethod: normalized.paymentMethod
    });
    const customerAddressPromise = timeStage(timer, "address_load", () =>
      this.loadCustomerAndAddress(auth.userId, normalized.addressId)
    );
    void customerAddressPromise.catch(() => undefined);
    const productRowsPromise = timeStage(timer, "product_store_load", () =>
      this.loadProducts(normalized.items.map((item) => item.variantId))
    );
    const productRows = await productRowsPromise.catch(async (error) => {
      await customerAddressPromise.catch(() => undefined);
      throw error;
    });
    const checkoutIntent = await timeStage(timer, "resolve_intent", () =>
      this.resolveCheckoutPaymentIntent(normalized, productRows)
    );
    updateCheckoutTraceContext({
      storeId: checkoutIntent.storeId,
      paymentMethod: checkoutIntent.methodKey
    });
    const requestHash = this.idempotency.hash({
      ...normalized,
      storeId: checkoutIntent.storeId,
      paymentMethod: checkoutIntent.methodKey,
      idempotencyKey: undefined
    });
    const reservation = await timeStage(timer, "idempotency_reserve", () => this.idempotency.reserve({
      key: normalized.idempotencyKey,
      userId: auth.userId,
      operation: "checkout.session.create.v1",
      requestHash,
      ttlMs: 7 * 24 * 60 * 60 * 1000
    }));
    if (reservation.state === "replayed") {
      return reservation.response;
    }

    try {
      if (checkoutIntent.methodKey === "phonepe") {
        const response = await this.createPhonepeSession(
          auth,
          normalized,
          requestHash,
          requestId,
          timer,
          productRows,
          customerAddressPromise
        );
        await timeStage(timer, "idempotency_complete", () => this.idempotency.complete(reservation, response));
        return response;
      }

      if (checkoutIntent.methodKey === "cod") {
        const response = await this.createCodOrder(
          auth,
          normalized,
          requestHash,
          requestId,
          timer,
          productRows,
          customerAddressPromise
        );
        await timeStage(timer, "idempotency_complete", () => this.idempotency.complete(reservation, response));
        return response;
      }
    } catch (error) {
      const handled = await this.handleCheckoutCreationError(
        error,
        normalized.idempotencyKey,
        checkoutIntent.provider,
        requestId
      );
      if (handled) {
        await timeStage(timer, "idempotency_complete", () => this.idempotency.complete(reservation, handled));
        return handled;
      }
      await this.idempotency.fail(reservation, errorBody(error));
      throw error;
    }
  }

  async availableMethods(storeId?: string) {
    if (!storeId) {
      return { apiVersion: "v1", methods: [] };
    }

    const store = await this.prisma.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: { id: true, status: true }
    });
    if (!store || store.status !== "APPROVED") {
      return { apiVersion: "v1", methods: [] };
    }

    return { apiVersion: "v1", methods: await this.storeOwnedCheckoutMethods(store.id) };
  }

  private async resolveCheckoutPaymentIntent(
    normalized: ReturnType<typeof normalizeCheckout>,
    productRows?: CheckoutProductRow[]
  ): Promise<CheckoutPaymentIntent> {
    const storeId = productRows
      ? this.resolveCheckoutStoreIdFromProductRows(normalized, productRows)
      : await this.resolveCheckoutStoreId(normalized);

    if (normalized.paymentMethod === "cashfree") {
      throw paymentError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "STORE_PAYMENT_METHOD_REQUIRED",
        "This store accepts only store-owned payment methods. Enable PhonePe or Cash on Delivery for this store.",
        true,
        undefined,
        60
      );
    }

    if (normalized.paymentMethod === "cod") {
      return checkoutPaymentIntent(storeId, "cod");
    }

    if (normalized.paymentMethod) {
      if (normalized.paymentMethod !== "phonepe") {
        throw paymentError(
          HttpStatus.SERVICE_UNAVAILABLE,
          "CHECKOUT_PAYMENT_METHOD_UNAVAILABLE",
          "The selected payment method is not available for this store.",
          true,
          { requestedPaymentMethod: normalized.paymentMethod },
          60
        );
      }
      const methods = await this.storeOwnedCheckoutMethods(storeId);
      const selected = methods.find((method) => method.key === normalized.paymentMethod);
      if (selected) {
        return checkoutPaymentIntent(storeId, selected.key);
      }
      throw paymentError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "CHECKOUT_PAYMENT_METHOD_UNAVAILABLE",
        "The selected payment method is not available for this store.",
        true,
        { requestedPaymentMethod: normalized.paymentMethod },
        60
      );
    }

    const methods = await this.storeOwnedCheckoutMethods(storeId);
    const fallback = methods[0];
    if (!fallback) {
      throw paymentError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "STORE_PAYMENT_METHODS_NOT_CONFIGURED",
        "This store has not enabled PhonePe or Cash on Delivery yet.",
        true,
        undefined,
        60
      );
    }

    return checkoutPaymentIntent(storeId, fallback.key);
  }

  private async storeOwnedCheckoutMethods(storeId: string): Promise<CheckoutMethodOption[]> {
    const enabledSettings = await this.paymentSettings.getStoreProviderSettings(storeId);
    const codSetting = enabledSettings.find((setting) => setting.provider === PaymentProvider.COD);
    return [
      ...enabledSettings
      .flatMap((setting): CheckoutMethodOption[] => {
        if (setting.provider === PaymentProvider.PHONEPE && phonepeSettingIsConnected(setting)) {
          return [{
            key: "phonepe",
            name: setting.displayName ?? "PhonePe",
            enabled: true,
            priority: setting.displayPriority ?? 2
          }];
        }
        return [];
      }),
      codCheckoutMethod(codSetting)
    ]
      .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  }

  private async createPhonepeSession(
    auth: AuthenticatedPrincipal,
    normalized: ReturnType<typeof normalizeCheckout>,
    requestHash: string,
    requestId?: string,
    timer?: RequestTimer,
    productRows?: CheckoutProductRow[],
    customerAddress?: Promise<CheckoutCustomerAddress>
  ) {
    const storeId = productRows
      ? this.resolveCheckoutStoreIdFromProductRows(normalized, productRows)
      : await this.resolveCheckoutStoreId(normalized);
    const credentials = await this.paymentSettings.resolvePhonepeCredentials(storeId);
    const prepared = await this.prepareLocalCheckout(auth, normalized, requestHash, requestId, {
      method: PaymentMethod.PHONEPE,
      provider: PaymentProvider.PHONEPE
    }, timer, productRows, customerAddress);
    const merchantOrderId = prepared.phonepeMerchantOrderId!;
    const gatewayRequest = {
      merchantOrderId,
      amountPaise: prepared.grandTotalPaise.toString(),
      redirectUrl: this.phonepeReturnUrl(prepared.orderId, prepared.paymentId),
      expiresAt: prepared.expiresAt.toISOString()
    };
    const phonepeOrder = await this.phonepe.createPayment({
      credentials,
      merchantOrderId,
      amountPaise: prepared.grandTotalPaise,
      redirectUrl: gatewayRequest.redirectUrl,
      expireAfterSeconds: Math.max(60, Math.floor((prepared.expiresAt.getTime() - Date.now()) / 1000)),
      metadata: {
        orderId: prepared.orderId,
        paymentId: prepared.paymentId,
        attemptId: prepared.attemptId
      }
    });
    const redirectUrl = this.phonepe.redirectUrlFromResponse(phonepeOrder);
    if (!redirectUrl) {
      throw new PhonepeGatewayError("PhonePe did not return a redirect URL.", true, 502, phonepeOrder);
    }
    return this.markPhonepeSessionCreated(prepared, {
      merchantOrderId,
      gatewayRequest,
      gatewayResponse: phonepeOrder,
      redirectUrl,
      callbackUrl: this.phonepeWebhookUrl(),
      phonepeMerchantId: credentials.merchantId
    }, requestId);
  }

  private async createCodOrder(
    auth: AuthenticatedPrincipal,
    normalized: ReturnType<typeof normalizeCheckout>,
    requestHash: string,
    requestId?: string,
    timer?: RequestTimer,
    productRows?: CheckoutProductRow[],
    customerAddress?: Promise<CheckoutCustomerAddress>
  ) {
    const prepared = await this.prepareLocalCheckout(auth, normalized, requestHash, requestId, {
      method: PaymentMethod.COD,
      provider: PaymentProvider.COD
    }, timer, productRows, customerAddress);
    return {
      apiVersion: "v1",
      status: "COD_CONFIRMED",
      provider: "cod",
      orderId: prepared.orderId,
      paymentId: prepared.paymentId,
      attemptId: prepared.attemptId,
      totals: prepared.responseTotals,
      expiresAt: prepared.expiresAt.toISOString()
    };
  }

  private async prepareLocalCheckout(
    auth: AuthenticatedPrincipal,
    dto: ReturnType<typeof normalizeCheckout>,
    requestHash: string,
    requestId?: string,
    options: {
      method: PaymentMethod;
      provider: PaymentProvider;
      gatewayOrderId?: string | null;
    } = {
      method: PaymentMethod.CASHFREE,
      provider: PaymentProvider.CASHFREE
    },
    timer?: RequestTimer,
    preloadedProductRows?: CheckoutProductRow[],
    preloadedCustomerAddress?: Promise<CheckoutCustomerAddress>
  ) {
    const productRows = preloadedProductRows ?? await timeStage(timer, "product_store_load", () =>
      this.loadProducts(dto.items.map((item) => item.variantId))
    );
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

    const { address, customer } = preloadedCustomerAddress
      ? await preloadedCustomerAddress
      : await timeStage(timer, "address_load", () => this.loadCustomerAndAddress(auth.userId, dto.addressId));
    timer?.add("customer_load", 0);
    if (!address && store.isDeliveryAvailable) {
      throw paymentError(HttpStatus.BAD_REQUEST, "CHECKOUT_ADDRESS_REQUIRED", "Choose a delivery address before checkout.");
    }

    const quote = timeStageSync(timer, "quote_calc", () => {
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
      const subtotalPaise = items.reduce((total, item) => total + item.lineSubtotalPaise, 0n);
      const discountPaise = discountFor(dto.couponCode, subtotalPaise);
      const lineDiscounts = allocateByLargestRemainder(discountPaise, items.map((item) => item.lineSubtotalPaise));
      const taxPaise = items.reduce((total, item, index) => {
        const discounted = item.lineSubtotalPaise - lineDiscounts[index]!;
        return total + percentBasisPoints(discounted, GST_BASIS_POINTS);
      }, 0n);
      const deliveryFeePaise = dto.shippingOption === "priority" ? 4_900n : 0n;
      const grandTotalPaise = subtotalPaise - discountPaise + taxPaise + deliveryFeePaise;
      return { items, subtotalPaise, discountPaise, lineDiscounts, taxPaise, deliveryFeePaise, grandTotalPaise };
    });
    const { items, subtotalPaise, discountPaise, lineDiscounts, taxPaise, deliveryFeePaise, grandTotalPaise } = quote;

    await this.inventory.admitCheckout({
      storeId,
      items: items.map((item) => ({ productVariantId: item.variantId }))
    });

    if (grandTotalPaise <= 0n) {
      throw paymentError(HttpStatus.BAD_REQUEST, "CHECKOUT_TOTAL_INVALID", "Checkout total must be greater than zero.");
    }

    const expiresAt = new Date(Date.now() + CHECKOUT_TTL_MS);
    const quotePayload = {
      userId: auth.userId,
      storeId,
      addressId: address?.id ?? null,
      currency: INR,
      paymentMethod: options.method,
      paymentProvider: options.provider,
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
    const cashfreeOrderId = options.method === PaymentMethod.CASHFREE ? `nma_${orderId}` : null;
    const phonepeMerchantOrderId =
      options.method === PaymentMethod.PHONEPE
        ? options.gatewayOrderId ?? `nma_pp_${orderId.replace(/-/g, "").slice(0, 24)}`
        : null;
    const isCodCheckout = options.method === PaymentMethod.COD;
    const createdOrderStatus = isCodCheckout ? OrderStatus.FULFILLMENT_READY : OrderStatus.PENDING_PAYMENT;
    const createdPaymentStatus = isCodCheckout ? PaymentStatus.AUTHORIZED : PaymentStatus.INITIATED;
    const createdAttemptStatus = isCodCheckout ? PaymentAttemptStatus.AUTHORIZED : PaymentAttemptStatus.INITIATED;
    const createdGatewayResponse = isCodCheckout ? { provider: "COD" } : {};

    if (isCodCheckout) {
      const fastStartedAt = Date.now();
      const fastResult = await this.createCodCheckoutFast({
        auth,
        address,
        attemptId,
        checkoutSessionId,
        createdGatewayResponse,
        dto,
        expiresAt,
        grandTotalPaise,
        hash,
        items,
        lineDiscounts,
        orderId,
        paymentId,
        quotePayload,
        requestHash,
        requestId,
        storeId,
        subtotalPaise,
        discountPaise,
        taxPaise,
        deliveryFeePaise
      });
      if (fastResult === "created") {
        const durationMs = Date.now() - fastStartedAt;
        timer?.add("order_create_tx_wait", 0);
        timer?.add("order_create_tx", durationMs);
        timer?.add("cod_confirm_tx_wait", 0);
        timer?.add("cod_confirm_tx", durationMs);
        timer?.add("inventory_reserve", 0);
        await this.inventory.evictPublicStockCache(storeId, items.map((item) => item.variantId));
        return {
          orderId,
          paymentId,
          attemptId,
          checkoutSessionId,
          cashfreeOrderId,
          phonepeMerchantOrderId,
          storeId,
          expiresAt,
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
      if (fastResult === "out_of_stock") {
        throw paymentError(HttpStatus.CONFLICT, "CHECKOUT_OUT_OF_STOCK", "One or more items are out of stock.", false);
      }
    }

    const orderCreateTxQueuedAt = Date.now();
    await this.prisma.$transaction(async (tx) => {
      timer?.add("order_create_tx_wait", Date.now() - orderCreateTxQueuedAt);
      await timeStage(timer, "order_create_tx", async () => {
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
          status: createdOrderStatus,
          paymentMethod: options.method,
          paymentStatus: createdPaymentStatus,
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
          ...(isCodCheckout ? { confirmedAt: new Date() } : {}),
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
          method: options.method,
          provider: options.provider,
          status: createdPaymentStatus,
          amount: paiseToRupeeDecimal(grandTotalPaise),
          amountPaise: grandTotalPaise,
          currency: INR,
          idempotencyKey: dto.idempotencyKey,
          ...(cashfreeOrderId ? { cashfreeOrderId } : {}),
          gatewayProvider: options.provider,
          gatewayResponse: createdGatewayResponse
        }
      });

      await tx.paymentAttempt.create({
        data: {
          id: attemptId,
          orderId: order.id,
          paymentId,
          attemptNumber: 1,
          status: createdAttemptStatus,
          ...(cashfreeOrderId ? { cashfreeOrderId } : {}),
          amountPaise: grandTotalPaise,
          currency: INR,
          idempotencyKey: attemptId,
          expiresAt,
          gatewayRequest: quotePayload as Prisma.InputJsonValue,
          ...(isCodCheckout ? { gatewayResponse: createdGatewayResponse as Prisma.InputJsonValue } : {})
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

      if (isCodCheckout) {
        timer?.add("cod_confirm_tx_wait", 0);
        await timeStage(timer, "cod_confirm_tx", async () => {
          await timeStage(timer, "inventory_reserve", () => this.inventory.authorizeCodOrderStock(tx, {
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
          }));
          await tx.paymentEvent.createMany({
            data: [
              {
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
              },
              {
                paymentId,
                orderId: order.id,
                attemptId,
                eventType: "payment.status.changed",
                schemaVersion: 1,
                fromStatus: PaymentStatus.INITIATED,
                toStatus: PaymentStatus.AUTHORIZED,
                actorType: "CUSTOMER",
                actorUserId: auth.userId,
                reason: "cod_order_confirmed",
                requestId,
                payload: {} as Prisma.InputJsonValue
              }
            ]
          });
          await tx.orderStateTransition.createMany({
            data: [
              {
                orderId: order.id,
                fromStatus: OrderStatus.PENDING,
                toStatus: OrderStatus.PENDING_PAYMENT,
                actorType: "CUSTOMER",
                actorUserId: auth.userId,
                reason: "checkout_created",
                requestId,
                metadata: { checkoutSessionId } as Prisma.InputJsonValue
              },
              {
                orderId: order.id,
                fromStatus: OrderStatus.PENDING_PAYMENT,
                toStatus: OrderStatus.PAYMENT_CONFIRMED,
                actorType: "CUSTOMER",
                actorUserId: auth.userId,
                reason: "cod_order_confirmed",
                requestId,
                metadata: {} as Prisma.InputJsonValue
              },
              {
                orderId: order.id,
                fromStatus: OrderStatus.PAYMENT_CONFIRMED,
                toStatus: OrderStatus.FULFILLMENT_READY,
                actorType: "CUSTOMER",
                actorUserId: auth.userId,
                reason: "cod_inventory_finalized",
                requestId,
                metadata: {} as Prisma.InputJsonValue
              }
            ]
          });
          await tx.domainEvent.create({
            data: {
              schemaVersion: 1,
              eventType: "payment.cod.authorized",
              aggregateType: "payment",
              aggregateId: paymentId,
              idempotencyKey: `cod:${paymentId}`,
              producer: "namastore-api",
              payload: {
                orderId: order.id,
                paymentId,
                amountPaise: grandTotalPaise.toString()
              } as Prisma.InputJsonValue
            }
          });
        });
      } else {
        await timeStage(timer, "inventory_reserve", () => this.inventory.reserveOrderStock(tx, {
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
        }));

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
      }
      });
    });

    return {
      orderId,
      paymentId,
      attemptId,
      checkoutSessionId,
      cashfreeOrderId,
      phonepeMerchantOrderId,
      storeId,
      expiresAt,
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

  private async createCodCheckoutFast(input: {
    auth: AuthenticatedPrincipal;
    address: CheckoutAddressRow | null;
    attemptId: string;
    checkoutSessionId: string;
    createdGatewayResponse: Record<string, unknown>;
    dto: ReturnType<typeof normalizeCheckout>;
    expiresAt: Date;
    grandTotalPaise: bigint;
    hash: string;
    items: CheckoutQuoteItem[];
    lineDiscounts: bigint[];
    orderId: string;
    paymentId: string;
    quotePayload: unknown;
    requestHash: string;
    requestId?: string;
    storeId: string;
    subtotalPaise: bigint;
    discountPaise: bigint;
    taxPaise: bigint;
    deliveryFeePaise: bigint;
  }): Promise<"created" | "missing_inventory" | "out_of_stock"> {
    const lineValues = Prisma.join(input.items.map((item, index) => {
      const itemDiscount = input.lineDiscounts[index]!;
      const itemTax = percentBasisPoints(item.lineSubtotalPaise - itemDiscount, GST_BASIS_POINTS);
      const totalPaise = item.lineSubtotalPaise - itemDiscount + itemTax;
      return Prisma.sql`(
        ${item.productId}::uuid,
        ${item.variantId}::uuid,
        ${item.name},
        ${item.variantName},
        ${item.unitDisplay},
        ${item.quantityValue}::numeric,
        ${item.quantityUnit}::"MeasurementUnit",
        ${item.packType}::"PackType",
        ${item.quantity}::integer,
        ${paiseToRupeeDecimal(item.unitPricePaise)}::numeric,
        ${item.mrp}::numeric,
        ${paiseToRupeeDecimal(totalPaise)}::numeric,
        ${item.unitPricePaise}::bigint,
        ${itemDiscount}::bigint,
        ${itemTax}::bigint,
        ${totalPaise}::bigint,
        ${randomUUID()}::uuid
      )`;
    }));
    const itemCount = input.items.length;
    const quotePayloadJson = JSON.stringify(input.quotePayload);
    const gatewayResponseJson = JSON.stringify(input.createdGatewayResponse);
    const checkoutMetadataJson = JSON.stringify({ checkoutSessionId: input.checkoutSessionId });
    const emptyJson = "{}";
    const codDomainPayloadJson = JSON.stringify({
      orderId: input.orderId,
      paymentId: input.paymentId,
      amountPaise: input.grandTotalPaise.toString()
    });
    const address = input.address;
    const rows = await this.prisma.$queryRaw<CodCheckoutWriteResult[]>(Prisma.sql`
      WITH
      ctx AS (
        SELECT
          set_config('lock_timeout', '2s', true),
          set_config('app.current_store_id', ${input.storeId}, true),
          set_config('app.is_platform_admin', 'false', true)
      ),
      input_items (
        product_id,
        variant_id,
        name,
        variant_name,
        unit_display,
        quantity_value,
        quantity_unit,
        pack_type,
        quantity,
        unit_price,
        mrp,
        total,
        unit_price_paise,
        discount_paise,
        tax_paise,
        total_paise,
        reservation_id
      ) AS (
        VALUES ${lineValues}
      ),
      default_location AS (
        SELECT il.id
        FROM inventory_locations il
        CROSS JOIN ctx
        WHERE il.store_id = ${input.storeId}::uuid
          AND il.is_default = true
        ORDER BY il.created_at ASC
        LIMIT 1
      ),
      locked_inventory AS (
        SELECT
          ii.id,
          ii.store_id,
          ii.product_variant_id,
          ii.location_id,
          ii.available_stock,
          ii.reserved_stock,
          ii.sold_stock,
          ii.low_stock_threshold,
          ii.version,
          input_items.quantity,
          input_items.reservation_id
        FROM input_items
        JOIN inventory_items ii
          ON ii.product_variant_id = input_items.variant_id
         AND ii.store_id = ${input.storeId}::uuid
        JOIN default_location dl ON dl.id = ii.location_id
        ORDER BY ii.product_variant_id
        FOR UPDATE
      ),
      stock_check AS (
        SELECT
          COUNT(*)::integer AS locked_count,
          COUNT(*) FILTER (WHERE available_stock >= quantity)::integer AS available_count
        FROM locked_inventory
      ),
      insert_order AS (
        INSERT INTO orders (
          id,
          user_id,
          store_id,
          address_id,
          address_recipient_name,
          address_recipient_phone,
          address_line1,
          address_line2,
          address_city,
          address_state,
          address_pincode,
          address_latitude,
          address_longitude,
          status,
          payment_method,
          payment_status,
          subtotal,
          delivery_fee,
          total,
          currency,
          pricing_version,
          quote_hash,
          subtotal_paise,
          discount_paise,
          tax_paise,
          delivery_fee_paise,
          grand_total_paise,
          expires_at,
          confirmed_at,
          customer_note,
          updated_at
        )
        SELECT
          ${input.orderId}::uuid,
          ${input.auth.userId}::uuid,
          ${input.storeId}::uuid,
          ${address?.id ?? null}::uuid,
          ${address?.recipientName ?? null},
          ${address?.recipientPhone ?? null},
          ${address?.line1 ?? null},
          ${address?.line2 ?? null},
          ${address?.city ?? null},
          ${address?.state ?? null},
          ${address?.pincode ?? null},
          ${address?.latitude ?? null}::numeric,
          ${address?.longitude ?? null}::numeric,
          ${OrderStatus.FULFILLMENT_READY}::"OrderStatus",
          ${PaymentMethod.COD}::"PaymentMethod",
          ${PaymentStatus.AUTHORIZED}::"PaymentStatus",
          ${paiseToRupeeDecimal(input.subtotalPaise)}::numeric,
          ${paiseToRupeeDecimal(input.deliveryFeePaise)}::numeric,
          ${paiseToRupeeDecimal(input.grandTotalPaise)}::numeric,
          ${INR},
          ${PRICING_VERSION}::integer,
          ${input.hash},
          ${input.subtotalPaise}::bigint,
          ${input.discountPaise}::bigint,
          ${input.taxPaise}::bigint,
          ${input.deliveryFeePaise}::bigint,
          ${input.grandTotalPaise}::bigint,
          ${input.expiresAt}::timestamptz,
          now(),
          NULL,
          now()
        FROM stock_check
        WHERE locked_count = ${itemCount}::integer
          AND available_count = ${itemCount}::integer
        RETURNING id
      ),
      insert_order_items AS (
        INSERT INTO order_items (
          order_id,
          product_id,
          variant_id,
          name,
          variant_name,
          unit_display,
          quantity_value,
          quantity_unit,
          pack_type,
          quantity,
          unit_price,
          mrp,
          total,
          unit_price_paise,
          discount_paise,
          tax_paise,
          total_paise
        )
        SELECT
          insert_order.id,
          input_items.product_id,
          input_items.variant_id,
          input_items.name,
          input_items.variant_name,
          input_items.unit_display,
          input_items.quantity_value,
          input_items.quantity_unit,
          input_items.pack_type,
          input_items.quantity,
          input_items.unit_price,
          input_items.mrp,
          input_items.total,
          input_items.unit_price_paise,
          input_items.discount_paise,
          input_items.tax_paise,
          input_items.total_paise
        FROM input_items
        JOIN insert_order ON true
        RETURNING id
      ),
      insert_payment AS (
        INSERT INTO payments (
          id,
          order_id,
          method,
          provider,
          status,
          amount,
          amount_paise,
          currency,
          idempotency_key,
          gateway_provider,
          gateway_response,
          updated_at
        )
        SELECT
          ${input.paymentId}::uuid,
          insert_order.id,
          ${PaymentMethod.COD}::"PaymentMethod",
          ${PaymentProvider.COD}::"PaymentProvider",
          ${PaymentStatus.AUTHORIZED}::"PaymentStatus",
          ${paiseToRupeeDecimal(input.grandTotalPaise)}::numeric,
          ${input.grandTotalPaise}::bigint,
          ${INR},
          ${input.dto.idempotencyKey},
          ${PaymentProvider.COD},
          ${gatewayResponseJson}::jsonb,
          now()
        FROM insert_order
        RETURNING id
      ),
      insert_payment_attempt AS (
        INSERT INTO payment_attempts (
          id,
          order_id,
          payment_id,
          attempt_number,
          status,
          amount_paise,
          currency,
          idempotency_key,
          expires_at,
          gateway_request,
          gateway_response
        )
        SELECT
          ${input.attemptId}::uuid,
          insert_order.id,
          insert_payment.id,
          1,
          ${PaymentAttemptStatus.AUTHORIZED}::"PaymentAttemptStatus",
          ${input.grandTotalPaise}::bigint,
          ${INR},
          ${input.attemptId},
          ${input.expiresAt}::timestamptz,
          ${quotePayloadJson}::jsonb,
          ${gatewayResponseJson}::jsonb
        FROM insert_order
        JOIN insert_payment ON true
        RETURNING id
      ),
      insert_checkout_session AS (
        INSERT INTO checkout_sessions (
          id,
          user_id,
          store_id,
          order_id,
          idempotency_key,
          request_hash,
          quote_hash,
          currency,
          subtotal_paise,
          discount_paise,
          tax_paise,
          delivery_fee_paise,
          grand_total_paise,
          expires_at,
          payload
        )
        SELECT
          ${input.checkoutSessionId}::uuid,
          ${input.auth.userId}::uuid,
          ${input.storeId}::uuid,
          insert_order.id,
          ${input.dto.idempotencyKey},
          ${input.requestHash},
          ${input.hash},
          ${INR},
          ${input.subtotalPaise}::bigint,
          ${input.discountPaise}::bigint,
          ${input.taxPaise}::bigint,
          ${input.deliveryFeePaise}::bigint,
          ${input.grandTotalPaise}::bigint,
          ${input.expiresAt}::timestamptz,
          ${quotePayloadJson}::jsonb
        FROM insert_order
        RETURNING id
      ),
      insert_inventory_reservations AS (
        INSERT INTO inventory_reservations (
          id,
          store_id,
          order_id,
          product_variant_id,
          location_id,
          quantity,
          status,
          expires_at,
          confirmed_at
        )
        SELECT
          locked_inventory.reservation_id,
          ${input.storeId}::uuid,
          insert_order.id,
          locked_inventory.product_variant_id,
          locked_inventory.location_id,
          locked_inventory.quantity,
          ${"CONFIRMED"}::"InventoryReservationStatus",
          ${input.expiresAt}::timestamptz,
          now()
        FROM locked_inventory
        JOIN insert_order ON true
        RETURNING id, product_variant_id, location_id, quantity
      ),
      updated_inventory AS (
        UPDATE inventory_items ii
        SET
          available_stock = ii.available_stock - locked_inventory.quantity,
          sold_stock = ii.sold_stock + locked_inventory.quantity,
          version = ii.version + 1,
          updated_at = now()
        FROM locked_inventory
        JOIN insert_order ON true
        WHERE ii.id = locked_inventory.id
        RETURNING
          ii.id,
          ii.store_id,
          ii.product_variant_id,
          ii.location_id,
          locked_inventory.available_stock AS before_available_stock,
          ii.available_stock AS after_available_stock,
          locked_inventory.reserved_stock AS before_reserved_stock,
          ii.reserved_stock AS after_reserved_stock,
          locked_inventory.sold_stock AS before_sold_stock,
          ii.sold_stock AS after_sold_stock,
          locked_inventory.low_stock_threshold,
          ii.version,
          locked_inventory.quantity,
          locked_inventory.reservation_id
      ),
      update_product_variants AS (
        UPDATE product_variants pv
        SET
          stock = updated_inventory.after_available_stock,
          stock_on_hand = updated_inventory.after_available_stock + updated_inventory.after_reserved_stock,
          stock_reserved = updated_inventory.after_reserved_stock,
          stock_version = updated_inventory.version,
          updated_at = now()
        FROM updated_inventory
        WHERE pv.id = updated_inventory.product_variant_id
        RETURNING pv.id
      ),
      insert_inventory_ledger AS (
        INSERT INTO inventory_ledger (
          schema_version,
          store_id,
          product_variant_id,
          location_id,
          order_id,
          reservation_id,
          type,
          quantity,
          before_available_stock,
          after_available_stock,
          before_reserved_stock,
          after_reserved_stock,
          before_sold_stock,
          after_sold_stock,
          actor_type,
          actor_user_id,
          reason,
          idempotency_key
        )
        SELECT
          1,
          updated_inventory.store_id,
          updated_inventory.product_variant_id,
          updated_inventory.location_id,
          ${input.orderId}::uuid,
          updated_inventory.reservation_id,
          ${"SOLD"}::"InventoryLedgerType",
          GREATEST(updated_inventory.quantity, 1),
          updated_inventory.before_available_stock,
          updated_inventory.after_available_stock,
          updated_inventory.before_reserved_stock,
          updated_inventory.after_reserved_stock,
          updated_inventory.before_sold_stock,
          updated_inventory.after_sold_stock,
          'CUSTOMER',
          ${input.auth.userId}::uuid,
          'cod_order_authorized',
          ${input.dto.idempotencyKey}
        FROM updated_inventory
        RETURNING id
      ),
      insert_inventory_events AS (
        INSERT INTO domain_events (
          schema_version,
          event_type,
          aggregate_type,
          aggregate_id,
          idempotency_key,
          producer,
          payload
        )
        SELECT
          1,
          'inventory.confirmed.v1',
          'inventory',
          updated_inventory.id,
          ${input.dto.idempotencyKey} || ':cod-confirmed:' || updated_inventory.reservation_id::text,
          'namastore-api',
          jsonb_build_object(
            'eventId', ${input.dto.idempotencyKey} || ':cod-confirmed:' || updated_inventory.reservation_id::text,
            'eventType', 'inventory.confirmed.v1',
            'schemaVersion', 1,
            'aggregateType', 'inventory',
            'aggregateId', updated_inventory.id,
            'storeId', ${input.storeId},
            'idempotencyKey', ${input.dto.idempotencyKey} || ':cod-confirmed:' || updated_inventory.reservation_id::text,
            'occurredAt', now(),
            'producer', 'namastore-api',
            'traceId', ${input.requestId ?? null},
            'payload', jsonb_build_object(
              'orderId', ${input.orderId},
              'reservationId', updated_inventory.reservation_id,
              'productVariantId', updated_inventory.product_variant_id,
              'locationId', updated_inventory.location_id,
              'quantity', updated_inventory.quantity
            )
          )
        FROM updated_inventory
        RETURNING id
      ),
      insert_low_stock_events AS (
        INSERT INTO domain_events (
          schema_version,
          event_type,
          aggregate_type,
          aggregate_id,
          idempotency_key,
          producer,
          payload
        )
        SELECT
          1,
          'inventory.low_stock.v1',
          'inventory',
          updated_inventory.id,
          'low-stock:' || updated_inventory.id::text || ':' || to_char(now(), 'YYYY-MM-DD'),
          'namastore-api',
          jsonb_build_object(
            'eventId', 'low-stock:' || updated_inventory.id::text || ':' || to_char(now(), 'YYYY-MM-DD'),
            'eventType', 'inventory.low_stock.v1',
            'schemaVersion', 1,
            'aggregateType', 'inventory',
            'aggregateId', updated_inventory.id,
            'storeId', ${input.storeId},
            'idempotencyKey', 'low-stock:' || updated_inventory.id::text || ':' || to_char(now(), 'YYYY-MM-DD'),
            'occurredAt', now(),
            'producer', 'namastore-api',
            'traceId', ${input.requestId ?? null},
            'payload', jsonb_build_object(
              'productVariantId', updated_inventory.product_variant_id,
              'locationId', updated_inventory.location_id,
              'availableStock', updated_inventory.after_available_stock,
              'lowStockThreshold', updated_inventory.low_stock_threshold
            )
          )
        FROM updated_inventory
        WHERE updated_inventory.low_stock_threshold > 0
          AND updated_inventory.before_available_stock > updated_inventory.low_stock_threshold
          AND updated_inventory.after_available_stock <= updated_inventory.low_stock_threshold
        RETURNING id
      ),
      insert_payment_events AS (
        INSERT INTO payment_events (
          payment_id,
          order_id,
          attempt_id,
          event_type,
          schema_version,
          from_status,
          to_status,
          actor_type,
          actor_user_id,
          reason,
          request_id,
          payload
        )
        SELECT *
        FROM (
          VALUES
            (
              ${input.paymentId}::uuid,
              ${input.orderId}::uuid,
              ${input.attemptId}::uuid,
              'payment.initiated',
              1,
              NULL::"PaymentStatus",
              ${PaymentStatus.INITIATED}::"PaymentStatus",
              'CUSTOMER',
              ${input.auth.userId}::uuid,
              'checkout_created',
              ${input.requestId ?? null},
              ${quotePayloadJson}::jsonb
            ),
            (
              ${input.paymentId}::uuid,
              ${input.orderId}::uuid,
              ${input.attemptId}::uuid,
              'payment.status.changed',
              1,
              ${PaymentStatus.INITIATED}::"PaymentStatus",
              ${PaymentStatus.AUTHORIZED}::"PaymentStatus",
              'CUSTOMER',
              ${input.auth.userId}::uuid,
              'cod_order_confirmed',
              ${input.requestId ?? null},
              ${emptyJson}::jsonb
            )
        ) AS events (
          payment_id,
          order_id,
          attempt_id,
          event_type,
          schema_version,
          from_status,
          to_status,
          actor_type,
          actor_user_id,
          reason,
          request_id,
          payload
        )
        WHERE EXISTS (SELECT 1 FROM insert_order)
        RETURNING id
      ),
      insert_order_transitions AS (
        INSERT INTO order_state_transitions (
          order_id,
          from_status,
          to_status,
          actor_type,
          actor_user_id,
          reason,
          request_id,
          metadata
        )
        SELECT *
        FROM (
          VALUES
            (
              ${input.orderId}::uuid,
              ${OrderStatus.PENDING}::"OrderStatus",
              ${OrderStatus.PENDING_PAYMENT}::"OrderStatus",
              'CUSTOMER',
              ${input.auth.userId}::uuid,
              'checkout_created',
              ${input.requestId ?? null},
              ${checkoutMetadataJson}::jsonb
            ),
            (
              ${input.orderId}::uuid,
              ${OrderStatus.PENDING_PAYMENT}::"OrderStatus",
              ${OrderStatus.PAYMENT_CONFIRMED}::"OrderStatus",
              'CUSTOMER',
              ${input.auth.userId}::uuid,
              'cod_order_confirmed',
              ${input.requestId ?? null},
              ${emptyJson}::jsonb
            ),
            (
              ${input.orderId}::uuid,
              ${OrderStatus.PAYMENT_CONFIRMED}::"OrderStatus",
              ${OrderStatus.FULFILLMENT_READY}::"OrderStatus",
              'CUSTOMER',
              ${input.auth.userId}::uuid,
              'cod_inventory_finalized',
              ${input.requestId ?? null},
              ${emptyJson}::jsonb
            )
        ) AS transitions (
          order_id,
          from_status,
          to_status,
          actor_type,
          actor_user_id,
          reason,
          request_id,
          metadata
        )
        WHERE EXISTS (SELECT 1 FROM insert_order)
        RETURNING id
      ),
      insert_cod_domain_event AS (
        INSERT INTO domain_events (
          schema_version,
          event_type,
          aggregate_type,
          aggregate_id,
          idempotency_key,
          producer,
          payload
        )
        SELECT
          1,
          'payment.cod.authorized',
          'payment',
          ${input.paymentId}::uuid,
          ${`cod:${input.paymentId}`},
          'namastore-api',
          ${codDomainPayloadJson}::jsonb
        WHERE EXISTS (SELECT 1 FROM insert_order)
        RETURNING id
      )
      SELECT
        stock_check.locked_count AS "lockedCount",
        stock_check.available_count AS "availableCount",
        (SELECT COUNT(*)::integer FROM insert_order) AS "orderInserted",
        (SELECT COUNT(*)::integer FROM insert_inventory_reservations) AS "reservationCount"
      FROM stock_check
    `);
    const result = rows[0];
    if (!result) {
      return "missing_inventory";
    }
    const lockedCount = Number(result.lockedCount);
    const availableCount = Number(result.availableCount);
    const orderInserted = Number(result.orderInserted);
    const reservationCount = Number(result.reservationCount);
    if (lockedCount !== itemCount) {
      return "missing_inventory";
    }
    if (availableCount !== itemCount || orderInserted !== 1) {
      return "out_of_stock";
    }
    return reservationCount === itemCount ? "created" : "missing_inventory";
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

  private async markPhonepeSessionCreated(
    prepared: Awaited<ReturnType<CheckoutService["prepareLocalCheckout"]>>,
    phonepe: {
      merchantOrderId: string;
      gatewayRequest: Record<string, unknown>;
      gatewayResponse: Record<string, unknown>;
      redirectUrl: string;
      callbackUrl: string | null;
      phonepeMerchantId: string;
    },
    requestId?: string
  ) {
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: prepared.paymentId } });
      await tx.paymentAttempt.update({
        where: { id: prepared.attemptId },
        data: {
          status: PaymentAttemptStatus.PENDING_GATEWAY,
          gatewayResponse: phonepe.gatewayResponse as Prisma.InputJsonValue
        }
      });
      await tx.payment.update({
        where: { id: prepared.paymentId },
        data: {
          gatewayProvider: PaymentProvider.PHONEPE,
          gatewayResponse: phonepe.gatewayResponse as Prisma.InputJsonValue
        }
      });
      await tx.phonepeTransaction.create({
        data: {
          paymentId: prepared.paymentId,
          orderId: prepared.orderId,
          storeId: prepared.storeId,
          merchantTransactionId: phonepe.merchantOrderId,
          phonepeMerchantId: phonepe.phonepeMerchantId,
          amountPaise: prepared.grandTotalPaise,
          currency: INR,
          status: "INITIATED",
          redirectUrl: phonepe.redirectUrl,
          callbackUrl: phonepe.callbackUrl,
          gatewayRequest: phonepe.gatewayRequest as Prisma.InputJsonValue,
          gatewayResponse: phonepe.gatewayResponse as Prisma.InputJsonValue
        }
      });
      await this.transitions.transitionPayment(tx, {
        paymentId: prepared.paymentId,
        orderId: prepared.orderId,
        attemptId: prepared.attemptId,
        from: payment.status,
        to: PaymentStatus.SESSION_CREATED,
        context: { reason: "phonepe_session_created", requestId }
      });
      await this.transitions.transitionPayment(tx, {
        paymentId: prepared.paymentId,
        orderId: prepared.orderId,
        attemptId: prepared.attemptId,
        from: PaymentStatus.SESSION_CREATED,
        to: PaymentStatus.PENDING_GATEWAY,
        context: { reason: "phonepe_session_ready", requestId }
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
            provider: "PHONEPE",
            merchantOrderId: phonepe.merchantOrderId
          } as Prisma.InputJsonValue
        }
      });
    });

    return {
      apiVersion: "v1",
      status: "SESSION_CREATED",
      provider: "phonepe",
      orderId: prepared.orderId,
      paymentId: prepared.paymentId,
      attemptId: prepared.attemptId,
      merchantOrderId: phonepe.merchantOrderId,
      redirectUrl: phonepe.redirectUrl,
      totals: prepared.responseTotals,
      expiresAt: prepared.expiresAt.toISOString()
    };
  }

  private async markCodConfirmed(
    prepared: Awaited<ReturnType<CheckoutService["prepareLocalCheckout"]>>,
    requestId?: string,
    timer?: RequestTimer
  ) {
    const codConfirmTxQueuedAt = Date.now();
    await this.prisma.$transaction(async (tx) => {
      timer?.add("cod_confirm_tx_wait", Date.now() - codConfirmTxQueuedAt);
      await timeStage(timer, "cod_confirm_tx", async () => {
      const current = await tx.payment.findUniqueOrThrow({
        where: { id: prepared.paymentId },
        include: { order: true, attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } }
      });
      const activeAttempt = current.attempts[0];
      const inventoryResult = await this.inventory.confirmOrderStock(tx, {
        storeId: prepared.storeId,
        orderId: prepared.orderId,
        idempotencyKey: `cod:${prepared.paymentId}`,
        requestId
      });

      if (inventoryResult.status === "REQUIRES_REVIEW") {
        await tx.paymentAttempt.updateMany({
          where: { paymentId: prepared.paymentId, status: { in: [PaymentAttemptStatus.INITIATED] } },
          data: {
            status: PaymentAttemptStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW,
            gatewayResponse: { provider: "COD", inventory: inventoryResult } as Prisma.InputJsonValue
          }
        });
        await tx.payment.update({
          where: { id: prepared.paymentId },
          data: {
            gatewayProvider: PaymentProvider.COD,
            gatewayResponse: { provider: "COD", inventory: inventoryResult } as Prisma.InputJsonValue
          }
        });
        await this.transitions.transitionPayment(tx, {
          paymentId: prepared.paymentId,
          orderId: prepared.orderId,
          attemptId: activeAttempt?.id,
          from: current.status,
          to: PaymentStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW,
          context: {
            reason: "cod_inventory_confirmation_requires_review",
            requestId,
            metadata: inventoryResult as Prisma.InputJsonValue
          }
        });
        await tx.order.update({
          where: { id: prepared.orderId },
          data: { paymentStatus: PaymentStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW }
        });
        await this.transitions.transitionOrder(tx, {
          orderId: prepared.orderId,
          from: current.order.status,
          to: OrderStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW,
          context: {
            reason: "cod_inventory_confirmation_requires_review",
            requestId,
            metadata: inventoryResult as Prisma.InputJsonValue
          }
        });
        return;
      }

      await tx.paymentAttempt.updateMany({
        where: { paymentId: prepared.paymentId, status: { in: [PaymentAttemptStatus.INITIATED] } },
        data: {
          status: PaymentAttemptStatus.AUTHORIZED,
          gatewayResponse: { provider: "COD", inventory: inventoryResult } as Prisma.InputJsonValue
        }
      });
      await tx.payment.update({
        where: { id: prepared.paymentId },
        data: {
          gatewayProvider: PaymentProvider.COD,
          gatewayResponse: { provider: "COD", inventory: inventoryResult } as Prisma.InputJsonValue
        }
      });
      await this.transitions.transitionPayment(tx, {
        paymentId: prepared.paymentId,
        orderId: prepared.orderId,
        attemptId: activeAttempt?.id,
        from: current.status,
        to: PaymentStatus.AUTHORIZED,
        context: { reason: "cod_order_confirmed", requestId }
      });
      await tx.order.update({
        where: { id: prepared.orderId },
        data: { paymentStatus: PaymentStatus.AUTHORIZED }
      });
      await this.transitions.transitionOrder(tx, {
        orderId: prepared.orderId,
        from: current.order.status,
        to: OrderStatus.PAYMENT_CONFIRMED,
        context: { reason: "cod_order_confirmed", requestId }
      });
      await this.transitions.transitionOrder(tx, {
        orderId: prepared.orderId,
        from: OrderStatus.PAYMENT_CONFIRMED,
        to: OrderStatus.FULFILLMENT_READY,
        context: { reason: "cod_inventory_finalized", requestId }
      });
      await tx.domainEvent.create({
        data: {
          schemaVersion: 1,
          eventType: "payment.cod.authorized",
          aggregateType: "payment",
          aggregateId: prepared.paymentId,
          idempotencyKey: `cod:${prepared.paymentId}`,
          producer: "namastore-api",
          payload: {
            orderId: prepared.orderId,
            paymentId: prepared.paymentId,
            amountPaise: prepared.grandTotalPaise.toString()
          } as Prisma.InputJsonValue
        }
      });
      });
    }, CHECKOUT_CONFIRM_TRANSACTION_OPTIONS);

    return {
      apiVersion: "v1",
      status: "COD_CONFIRMED",
      provider: "cod",
      orderId: prepared.orderId,
      paymentId: prepared.paymentId,
      attemptId: prepared.attemptId,
      totals: prepared.responseTotals,
      expiresAt: prepared.expiresAt.toISOString()
    };
  }

  private async handleCheckoutCreationError(error: unknown, idempotencyKey: string, provider: PaymentProvider, requestId?: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { idempotencyKey },
      include: { order: true, attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } }
    });
    if (!payment) {
      return null;
    }

    const gatewayLabel = providerLabel(provider);
    const gatewayError = error instanceof CashfreeGatewayError || error instanceof PhonepeGatewayError ? error : null;
    const retryableUnknown = Boolean(gatewayError?.retryable || gatewayError?.timedOut);
    if (!retryableUnknown) {
      await this.prisma.$transaction(async (tx) => {
        await this.inventory.releaseOrderStock(tx, {
          storeId: payment.order.storeId,
          orderId: payment.orderId,
          reason: `${gatewayLabel}_create_failed`,
          idempotencyKey: `checkout-create-failed:${gatewayLabel}:${payment.id}`,
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
          context: { reason: `${gatewayLabel}_create_failed`, requestId, metadata: errorBody(error) as Prisma.InputJsonValue }
        });
        await this.transitions.transitionOrder(tx, {
          orderId: payment.orderId,
          from: payment.order.status,
          to: OrderStatus.PAYMENT_FAILED,
          context: { reason: `${gatewayLabel}_create_failed`, requestId }
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
        context: { reason: `${gatewayLabel}_create_unknown`, requestId, metadata: errorBody(error) as Prisma.InputJsonValue }
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

  private async loadCustomerAndAddress(userId: string, addressId?: string) {
    const rows = await this.prisma.$queryRaw<Array<{
      customerId: string;
      email: string;
      fullName: string | null;
      phone: string | null;
      addressId: string | null;
      recipientName: string | null;
      recipientPhone: string | null;
      line1: string | null;
      line2: string | null;
      city: string | null;
      state: string | null;
      pincode: string | null;
      latitude: Prisma.Decimal | null;
      longitude: Prisma.Decimal | null;
    }>>(Prisma.sql`
      WITH selected_address AS (
        SELECT
          id,
          recipient_name,
          recipient_phone,
          line1,
          line2,
          city,
          state,
          pincode,
          latitude,
          longitude
        FROM addresses
        WHERE user_id = ${userId}::uuid
          AND deleted_at IS NULL
          ${addressId ? Prisma.sql`AND id = ${addressId}::uuid` : Prisma.sql`AND is_default = true`}
        ORDER BY updated_at DESC
        LIMIT 1
      )
      SELECT
        users.id AS "customerId",
        users.email,
        users.full_name AS "fullName",
        users.phone,
        selected_address.id AS "addressId",
        selected_address.recipient_name AS "recipientName",
        selected_address.recipient_phone AS "recipientPhone",
        selected_address.line1,
        selected_address.line2,
        selected_address.city,
        selected_address.state,
        selected_address.pincode,
        selected_address.latitude,
        selected_address.longitude
      FROM users
      LEFT JOIN selected_address ON true
      WHERE users.id = ${userId}::uuid
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) {
      throw paymentError(HttpStatus.UNAUTHORIZED, "CHECKOUT_CUSTOMER_NOT_FOUND", "Sign in again before checkout.");
    }
    return {
      customer: {
        id: row.customerId,
        email: row.email,
        fullName: row.fullName,
        phone: row.phone
      } satisfies CheckoutCustomerRow,
      address: row.addressId
        ? {
            id: row.addressId,
            recipientName: row.recipientName,
            recipientPhone: row.recipientPhone,
            line1: row.line1 ?? "",
            line2: row.line2,
            city: row.city ?? "",
            state: row.state ?? "",
            pincode: row.pincode ?? "",
            latitude: row.latitude,
            longitude: row.longitude
          } satisfies CheckoutAddressRow
        : null
    };
  }

  private async loadProducts(variantIds: string[]) {
    if (!variantIds.length) {
      return [];
    }
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      productId: string;
      name: string;
      price: Prisma.Decimal;
      mrp: Prisma.Decimal | null;
      quantityValue: Prisma.Decimal;
      quantityUnit: string;
      packType: string;
      productName: string;
      productStatus: string;
      productIsActive: boolean;
      storeId: string;
      storeStatus: string;
      storeDeletedAt: Date | null;
      storeIsDeliveryAvailable: boolean;
    }>>(Prisma.sql`
      SELECT
        pv.id,
        pv.product_id AS "productId",
        pv.name,
        pv.price,
        pv.mrp,
        pv.quantity_value AS "quantityValue",
        pv.quantity_unit AS "quantityUnit",
        pv.pack_type AS "packType",
        p.name AS "productName",
        p.status AS "productStatus",
        p.is_active AS "productIsActive",
        p.store_id AS "storeId",
        s.status AS "storeStatus",
        s.deleted_at AS "storeDeletedAt",
        s.is_delivery_available AS "storeIsDeliveryAvailable"
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      JOIN stores s ON s.id = p.store_id
      WHERE pv.id IN (${Prisma.join(variantIds.map((id) => Prisma.sql`${id}::uuid`))})
    `);
    return rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      name: row.name,
      price: row.price,
      mrp: row.mrp,
      quantityValue: row.quantityValue,
      quantityUnit: row.quantityUnit as CheckoutProductRow["quantityUnit"],
      packType: row.packType as CheckoutProductRow["packType"],
      product: {
        id: row.productId,
        storeId: row.storeId,
        name: row.productName,
        status: row.productStatus as CheckoutProductRow["product"]["status"],
        isActive: row.productIsActive,
        store: {
          id: row.storeId,
          status: row.storeStatus as CheckoutProductRow["product"]["store"]["status"],
          deletedAt: row.storeDeletedAt,
          isDeliveryAvailable: row.storeIsDeliveryAvailable
        }
      }
    }));
  }

  private async resolveCheckoutStoreId(dto: ReturnType<typeof normalizeCheckout>) {
    const rows = await this.prisma.productVariant.findMany({
      where: { id: { in: dto.items.map((item) => item.variantId) } },
      select: {
        id: true,
        product: {
          select: {
            storeId: true,
            store: { select: { status: true, deletedAt: true } }
          }
        }
      }
    });
    if (rows.length !== dto.items.length) {
      throw paymentError(HttpStatus.CONFLICT, "CHECKOUT_PRODUCT_UNAVAILABLE", "One or more products are no longer available.");
    }
    const storeIds = new Set(rows.map((row) => row.product.storeId));
    if (storeIds.size !== 1) {
      throw paymentError(HttpStatus.BAD_REQUEST, "CHECKOUT_SINGLE_STORE_REQUIRED", "Checkout currently supports one store at a time.");
    }
    const row = rows[0]!;
    if (row.product.store.status !== "APPROVED" || row.product.store.deletedAt) {
      throw paymentError(HttpStatus.CONFLICT, "CHECKOUT_STORE_UNAVAILABLE", "This store is not accepting orders.");
    }
    return row.product.storeId;
  }

  private resolveCheckoutStoreIdFromProductRows(
    dto: ReturnType<typeof normalizeCheckout>,
    rows: CheckoutProductRow[]
  ) {
    if (rows.length !== dto.items.length) {
      throw paymentError(HttpStatus.CONFLICT, "CHECKOUT_PRODUCT_UNAVAILABLE", "One or more products are no longer available.");
    }
    const storeIds = new Set(rows.map((row) => row.product.storeId));
    if (storeIds.size !== 1) {
      throw paymentError(HttpStatus.BAD_REQUEST, "CHECKOUT_SINGLE_STORE_REQUIRED", "Checkout currently supports one store at a time.");
    }
    const row = rows[0]!;
    if (row.product.store.status !== "APPROVED" || row.product.store.deletedAt) {
      throw paymentError(HttpStatus.CONFLICT, "CHECKOUT_STORE_UNAVAILABLE", "This store is not accepting orders.");
    }
    return row.product.storeId;
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

  private phonepeReturnUrl(orderId: string, paymentId: string) {
    const configured = this.config.get<string>("PHONEPE_RETURN_URL");
    if (configured) {
      const url = new URL(configured);
      url.searchParams.set("orderId", orderId);
      url.searchParams.set("paymentId", paymentId);
      return url.toString();
    }
    return `${this.config.get<string>("FRONTEND_URL", "http://localhost:3000")}/en/checkout/status?orderId=${orderId}&paymentId=${paymentId}`;
  }

  private phonepeWebhookUrl() {
    return this.config.get<string>("PHONEPE_NOTIFY_URL") ?? null;
  }
}

async function timeStage<T>(timer: RequestTimer | undefined, stage: string, callback: () => Promise<T>): Promise<T> {
  return timer ? timer.time(stage, callback) : callback();
}

function timeStageSync<T>(timer: RequestTimer | undefined, stage: string, callback: () => T): T {
  return timer ? timer.timeSync(stage, callback) : callback();
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
    paymentMethod: dto.paymentMethod,
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

function checkoutPaymentIntent(storeId: string, methodKey: StoreOwnedCheckoutMethodKey): CheckoutPaymentIntent {
  return {
    storeId,
    methodKey,
    provider: methodKey === "phonepe" ? PaymentProvider.PHONEPE : PaymentProvider.COD
  };
}

function codCheckoutMethod(setting?: { displayName: string | null; displayPriority: number | null }): CheckoutMethodOption {
  return {
    key: "cod",
    name: setting?.displayName ?? "Cash on Delivery",
    enabled: true,
    priority: setting?.displayPriority ?? 3
  };
}

function phonepeSettingIsConnected(setting: {
  merchantId?: string | null;
  clientIdEncrypted?: string | null;
  clientSecretEncrypted?: string | null;
}) {
  return Boolean(setting.merchantId?.trim() && setting.clientIdEncrypted && setting.clientSecretEncrypted);
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
      timedOut: error.timedOut,
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
  if (error && typeof error === "object" && "response" in error) {
    return { code: "CHECKOUT_ERROR", response: (error as { response?: unknown }).response as Prisma.InputJsonValue };
  }
  return { code: "CHECKOUT_ERROR", message: error instanceof Error ? error.message : String(error) };
}
