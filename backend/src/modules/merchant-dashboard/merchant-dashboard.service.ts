import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { OrderStatus, PaymentStatus, Prisma, StoreStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuthenticatedPrincipal } from "../auth/auth.types";
import { PaymentTransitionService } from "../payments/payment-transition.service";
import { ShopsService } from "../shops/shops.service";
import { MerchantOrderStatusUpdateDto } from "./dto/merchant-orders.dto";
import { UpdateStoreLocationDto } from "./dto/merchant-settings.dto";
import { MerchantDashboardBootstrap, MerchantStoreLocation } from "./merchant-dashboard.types";

interface DashboardBootstrapRow {
  user_id: string;
  user_email: string;
  full_name: string | null;
  avatar_url: string | null;
  store_id: string;
  store_name: string;
  store_slug: string;
  store_status: StoreStatus;
  store_address_line: string | null;
  store_city: string | null;
  store_state: string | null;
  store_pincode: string | null;
  store_latitude: Prisma.Decimal | number | string | null;
  store_longitude: Prisma.Decimal | number | string | null;
  store_updated_at: Date;
  store_image_url: string | null;
  business_name: string | null;
  logo_url: string | null;
  role_code: string;
  role_name: string;
}

@Injectable()
export class MerchantDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: PaymentTransitionService,
    private readonly shops: ShopsService
  ) {}

  async bootstrap(auth: AuthenticatedPrincipal): Promise<MerchantDashboardBootstrap> {
    const membership = await this.activeMembership(auth);

    return {
      user: {
        id: membership.user_id,
        name: displayName(membership.full_name, membership.user_email),
        email: membership.user_email,
        avatarUrl: membership.avatar_url
      },
      store: {
        id: membership.store_id,
        name: membership.business_name?.trim() || membership.store_name,
        slug: membership.store_slug,
        status: membership.store_status,
        logoUrl: membership.logo_url ?? membership.store_image_url ?? null
      },
      membership: {
        roleCode: membership.role_code,
        roleName: membership.role_name
      }
    };
  }

  async getStoreLocation(auth: AuthenticatedPrincipal): Promise<MerchantStoreLocation> {
    const membership = await this.activeMembership(auth);
    return locationFromMembership(membership);
  }

  async updateStoreLocation(
    auth: AuthenticatedPrincipal,
    dto: UpdateStoreLocationDto
  ): Promise<MerchantStoreLocation> {
    const membership = await this.activeMembership(auth);
    const updated = await this.prisma.store.update({
      where: { id: membership.store_id },
      data: {
        latitude: roundCoordinate(dto.latitude),
        longitude: roundCoordinate(dto.longitude),
        ...(dto.addressLine === undefined ? {} : { addressLine: nullableText(dto.addressLine) }),
        ...(dto.city === undefined ? {} : { city: nullableText(dto.city) }),
        ...(dto.state === undefined ? {} : { state: nullableText(dto.state) }),
        ...(dto.pincode === undefined ? {} : { pincode: nullableText(dto.pincode) })
      },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        addressLine: true,
        city: true,
        state: true,
        pincode: true,
        latitude: true,
        longitude: true,
        updatedAt: true
      }
    });

    await this.shops.invalidateShopCaches({
      keyFamily: "all",
      operation: "merchant.location.update",
      storeId: updated.id
    });
    return locationFromStore(updated);
  }

  async orders(auth: AuthenticatedPrincipal) {
    const membership = await this.activeMembership(auth);
    const orders = await this.prisma.order.findMany({
      where: { storeId: membership.store_id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 250,
      select: merchantOrderSelect
    });

    return {
      apiVersion: "v1",
      orders: orders.map(toMerchantOrder)
    };
  }

  async order(auth: AuthenticatedPrincipal, orderId: string) {
    const membership = await this.activeMembership(auth);
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, storeId: membership.store_id },
      select: merchantOrderSelect
    });

    if (!order) {
      throw new NotFoundException({
        code: "MERCHANT_ORDER_NOT_FOUND",
        message: "Order was not found for this store."
      });
    }

    return {
      apiVersion: "v1",
      order: toMerchantOrder(order)
    };
  }

  async updateOrderStatus(auth: AuthenticatedPrincipal, dto: MerchantOrderStatusUpdateDto, requestId?: string) {
    const membership = await this.activeMembership(auth);
    const orderIds = Array.from(new Set(dto.orderIds)).sort();
    if (!orderIds.length) {
      throw new BadRequestException({
        code: "MERCHANT_ORDER_SELECTION_REQUIRED",
        message: "Select at least one order."
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const orders = await tx.order.findMany({
        where: { storeId: membership.store_id, id: { in: orderIds } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: merchantOrderSelect
      });
      const foundIds = new Set(orders.map((order) => order.id));
      const missing = orderIds.filter((id) => !foundIds.has(id));
      const skipped: Array<{ id: string; reason: string; status?: OrderStatus }> = missing.map((id) => ({
        id,
        reason: "not_found_or_not_in_store"
      }));
      const updatedIds: string[] = [];

      for (const order of orders) {
        const updated = dto.action === "MARK_PACKED"
          ? await this.moveOrderToPacking(tx, order, auth, requestId)
          : await this.moveOrderToRefundReview(tx, order, auth, requestId);
        if (updated.ok) {
          updatedIds.push(order.id);
        } else {
          skipped.push({ id: order.id, reason: updated.reason, status: order.status });
        }
      }

      const refreshed = updatedIds.length
        ? await tx.order.findMany({
            where: { storeId: membership.store_id, id: { in: updatedIds } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: merchantOrderSelect
          })
        : [];
      return {
        updated: refreshed.map(toMerchantOrder),
        updatedCount: updatedIds.length,
        skipped
      };
    });

    return {
      apiVersion: "v1",
      ...result
    };
  }

  private async moveOrderToPacking(
    tx: Prisma.TransactionClient,
    order: MerchantOrderRow,
    auth: AuthenticatedPrincipal,
    requestId?: string
  ) {
    if (order.status === OrderStatus.PACKING) {
      return { ok: true as const };
    }
    if (order.paymentStatus !== PaymentStatus.PAID) {
      return { ok: false as const, reason: "payment_not_paid" };
    }
    const path = packingTransitionPath(order.status);
    if (!path) {
      return { ok: false as const, reason: "status_not_packable" };
    }
    let from: OrderStatus = order.status;
    for (const to of path) {
      await this.transitions.transitionOrder(tx, {
        orderId: order.id,
        from,
        to,
        context: {
          reason: "merchant_marked_packed",
          requestId,
          actorType: "MERCHANT",
          actorUserId: auth.userId
        }
      });
      from = to;
    }
    return { ok: true as const };
  }

  private async moveOrderToRefundReview(
    tx: Prisma.TransactionClient,
    order: MerchantOrderRow,
    auth: AuthenticatedPrincipal,
    requestId?: string
  ) {
    if (order.status === OrderStatus.REFUND_PENDING || order.status === OrderStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW) {
      return { ok: true as const };
    }
    const allowed = new Set<OrderStatus>([
      OrderStatus.PAYMENT_CONFIRMED,
      OrderStatus.FULFILLMENT_READY,
      OrderStatus.DELIVERED,
      OrderStatus.RETURN_REQUESTED
    ]);
    if (!allowed.has(order.status)) {
      return { ok: false as const, reason: "status_not_refundable" };
    }
    await this.transitions.transitionOrder(tx, {
      orderId: order.id,
      from: order.status,
      to: OrderStatus.REFUND_PENDING,
      context: {
        reason: "merchant_moved_to_refund_review",
        requestId,
        actorType: "MERCHANT",
        actorUserId: auth.userId
      }
    });
    return { ok: true as const };
  }

  private async activeMembership(auth: AuthenticatedPrincipal): Promise<DashboardBootstrapRow> {
    const rows = await this.prisma.$queryRaw<DashboardBootstrapRow[]>`
      SELECT
        u.id AS user_id,
        u.email AS user_email,
        u.full_name,
        u.avatar_url,
        s.id AS store_id,
        s.name AS store_name,
        s.slug AS store_slug,
        s.status AS store_status,
        s.address_line AS store_address_line,
        s.city AS store_city,
        s.state AS store_state,
        s.pincode AS store_pincode,
        s.latitude AS store_latitude,
        s.longitude AS store_longitude,
        s.updated_at AS store_updated_at,
        s.image_url AS store_image_url,
        bp.business_name,
        logo.url AS logo_url,
        r.code AS role_code,
        r.name AS role_name
      FROM store_members sm
      JOIN users u ON u.id = sm.user_id
      JOIN roles r ON r.id = sm.role_id
      JOIN stores s ON s.id = sm.store_id
      LEFT JOIN store_business_profiles bp ON bp.store_id = s.id
      LEFT JOIN store_branding branding ON branding.store_id = s.id
      LEFT JOIN store_media logo ON logo.id = branding.logo_media_id
      WHERE sm.user_id = ${auth.userId}::uuid
        AND sm.status = 'ACTIVE'
        AND s.deleted_at IS NULL
        AND s.status IN ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED')
      ORDER BY
        CASE
          WHEN s.status = 'APPROVED' THEN 0
          WHEN s.status = 'PENDING' THEN 1
          ELSE 2
        END,
        s.created_at DESC,
        sm.joined_at DESC NULLS LAST,
        sm.created_at DESC
      LIMIT 1
    `;
    const membership = rows[0];

    if (!membership) {
      throw new ForbiddenException({
        code: "MERCHANT_STORE_REQUIRED",
        message: "No active merchant store is available for this account."
      });
    }

    return membership;
  }
}

const merchantOrderSelect = {
  id: true,
  status: true,
  paymentStatus: true,
  total: true,
  grandTotalPaise: true,
  addressRecipientName: true,
  addressCity: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      email: true,
      fullName: true
    }
  },
  payment: {
    select: {
      id: true,
      status: true,
      verifiedAt: true,
      createdAt: true
    }
  },
  items: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      name: true,
      variantName: true,
      unitDisplay: true,
      quantity: true,
      unitPrice: true,
      unitPricePaise: true,
      total: true,
      totalPaise: true,
      product: {
        select: {
          imageUrl: true,
          sku: true
        }
      },
      variant: {
        select: {
          sku: true
        }
      }
    }
  },
  stateTransitions: {
    orderBy: { createdAt: "asc" as const },
    select: {
      toStatus: true,
      reason: true,
      createdAt: true
    }
  }
} satisfies Prisma.OrderSelect;

type MerchantOrderRow = Prisma.OrderGetPayload<{ select: typeof merchantOrderSelect }>;

function toMerchantOrder(order: MerchantOrderRow) {
  const itemCount = order.items.reduce((total, item) => total + item.quantity, 0);
  return {
    id: order.id,
    customer: order.addressRecipientName?.trim() || order.user.fullName?.trim() || displayName(null, order.user.email),
    email: order.user.email,
    total: order.grandTotalPaise > 0n ? Number(order.grandTotalPaise) / 100 : decimalToNumber(order.total) ?? 0,
    items: itemCount,
    lineItems: order.items.map((item) => ({
      id: item.id,
      name: item.name,
      variantName: item.variantName,
      unitDisplay: item.unitDisplay,
      quantity: item.quantity,
      unitPrice: item.unitPricePaise > 0n ? Number(item.unitPricePaise) / 100 : decimalToNumber(item.unitPrice) ?? 0,
      total: item.totalPaise > 0n ? Number(item.totalPaise) / 100 : decimalToNumber(item.total) ?? 0,
      imageUrl: item.product.imageUrl,
      sku: item.variant?.sku ?? item.product.sku
    })),
    status: dashboardOrderStatus(order.status),
    payment: dashboardPaymentStatus(order.paymentStatus, order.payment?.status ?? null),
    channel: "Storefront",
    city: order.addressCity?.trim() || "Not provided",
    placedAt: order.createdAt.toISOString(),
    timeline: merchantOrderTimeline(order)
  };
}

function merchantOrderTimeline(order: MerchantOrderRow) {
  const events = new Map<string, { label: string; at: string }>();
  addTimelineEvent(events, "created", "Order created", order.createdAt);
  if (order.payment?.verifiedAt) {
    addTimelineEvent(events, "payment-confirmed", "Payment confirmed", order.payment.verifiedAt);
  }
  for (const transition of order.stateTransitions) {
    const milestone = timelineMilestone(transition.toStatus);
    if (!milestone) {
      continue;
    }
    addTimelineEvent(events, milestone.key, milestone.label, transition.createdAt);
  }

  return Array.from(events.values()).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

function addTimelineEvent(
  events: Map<string, { label: string; at: string }>,
  key: string,
  label: string,
  at: Date
) {
  if (!events.has(key)) {
    events.set(key, { label, at: at.toISOString() });
  }
}

function timelineMilestone(status: OrderStatus) {
  switch (status) {
    case OrderStatus.PAYMENT_CONFIRMED:
      return { key: "payment-confirmed", label: "Payment confirmed" };
    case OrderStatus.PAYMENT_FAILED:
      return { key: "payment-failed", label: "Payment failed" };
    case OrderStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW:
      return { key: "inventory-review", label: "Inventory review required" };
    case OrderStatus.PACKING:
      return { key: "packing", label: "Packed" };
    case OrderStatus.OUT_FOR_DELIVERY:
      return { key: "out-for-delivery", label: "Shipped" };
    case OrderStatus.DELIVERED:
      return { key: "delivered", label: "Delivered" };
    case OrderStatus.REFUND_PENDING:
    case OrderStatus.RETURN_REQUESTED:
      return { key: "refund-requested", label: "Refund requested" };
    case OrderStatus.CANCELLED:
      return { key: "cancelled", label: "Cancelled" };
    case OrderStatus.EXPIRED:
      return { key: "expired", label: "Expired" };
    default:
      return null;
  }
}

function dashboardOrderStatus(status: OrderStatus) {
  switch (status) {
    case OrderStatus.PENDING:
    case OrderStatus.PENDING_PAYMENT:
      return "New";
    case OrderStatus.PAYMENT_CONFIRMED:
    case OrderStatus.FULFILLMENT_READY:
    case OrderStatus.ACCEPTED:
      return "Processing";
    case OrderStatus.PACKING:
      return "Packed";
    case OrderStatus.OUT_FOR_DELIVERY:
      return "Shipped";
    case OrderStatus.DELIVERED:
      return "Delivered";
    case OrderStatus.REFUND_PENDING:
    case OrderStatus.RETURN_REQUESTED:
    case OrderStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW:
      return "Refund review";
    case OrderStatus.CANCELLED:
    case OrderStatus.EXPIRED:
      return "Cancelled";
    case OrderStatus.PAYMENT_FAILED:
    case OrderStatus.REJECTED:
      return "Failed";
    default:
      return "Processing";
  }
}

function dashboardPaymentStatus(orderPaymentStatus: PaymentStatus, paymentStatus: PaymentStatus | null) {
  const status = paymentStatus ?? orderPaymentStatus;
  switch (status) {
    case PaymentStatus.PAID:
    case PaymentStatus.DUPLICATE_SUCCESS_REQUIRES_REFUND:
    case PaymentStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW:
      return "Paid";
    case PaymentStatus.REFUND_PENDING:
    case PaymentStatus.PARTIALLY_REFUNDED:
    case PaymentStatus.REFUNDED:
      return "Refunded";
    case PaymentStatus.FAILED:
    case PaymentStatus.EXPIRED:
    case PaymentStatus.USER_DROPPED:
      return "Failed";
    default:
      return "Authorized";
  }
}

function packingTransitionPath(status: OrderStatus) {
  switch (status) {
    case OrderStatus.PAYMENT_CONFIRMED:
      return [OrderStatus.FULFILLMENT_READY, OrderStatus.ACCEPTED, OrderStatus.PACKING];
    case OrderStatus.FULFILLMENT_READY:
      return [OrderStatus.ACCEPTED, OrderStatus.PACKING];
    case OrderStatus.ACCEPTED:
      return [OrderStatus.PACKING];
    default:
      return null;
  }
}

function displayName(fullName: string | null, email: string) {
  const trimmed = fullName?.trim();
  if (trimmed) {
    return trimmed;
  }
  return email.split("@")[0] || "Merchant";
}

function locationFromMembership(membership: DashboardBootstrapRow): MerchantStoreLocation {
  return {
    id: membership.store_id,
    name: membership.business_name?.trim() || membership.store_name,
    slug: membership.store_slug,
    status: membership.store_status,
    addressLine: membership.store_address_line,
    city: membership.store_city,
    state: membership.store_state,
    pincode: membership.store_pincode,
    latitude: decimalToNumber(membership.store_latitude),
    longitude: decimalToNumber(membership.store_longitude),
    googleMapsUrl: googleMapsUrl(membership.store_latitude, membership.store_longitude),
    updatedAt: membership.store_updated_at.toISOString()
  };
}

function locationFromStore(store: {
  id: string;
  name: string;
  slug: string;
  status: StoreStatus;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: Prisma.Decimal | number | string | null;
  longitude: Prisma.Decimal | number | string | null;
  updatedAt: Date;
}): MerchantStoreLocation {
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    status: store.status,
    addressLine: store.addressLine,
    city: store.city,
    state: store.state,
    pincode: store.pincode,
    latitude: decimalToNumber(store.latitude),
    longitude: decimalToNumber(store.longitude),
    googleMapsUrl: googleMapsUrl(store.latitude, store.longitude),
    updatedAt: store.updatedAt.toISOString()
  };
}

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function roundCoordinate(value: number) {
  return Math.round(value * 10_000_000) / 10_000_000;
}

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value == null) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

function googleMapsUrl(
  latitude: Prisma.Decimal | number | string | null | undefined,
  longitude: Prisma.Decimal | number | string | null | undefined
) {
  const lat = decimalToNumber(latitude);
  const lng = decimalToNumber(longitude);
  if (lat == null || lng == null) {
    return null;
  }
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
