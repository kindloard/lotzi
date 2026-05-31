import type { MerchantDashboardOrder } from "@/lib/merchant-dashboard-api";
import type { Order, OrderStatus, PaymentStatus } from "../types/dashboard";

export function toDashboardOrder(order: MerchantDashboardOrder): Order {
  return {
    id: order.id,
    customer: order.customer,
    email: order.email,
    total: order.total,
    items: order.items,
    lineItems: order.lineItems,
    status: normalizeOrderStatus(order.status),
    payment: normalizePaymentStatus(order.payment),
    channel: order.channel,
    city: order.city,
    placedAt: order.placedAt,
    timeline: order.timeline
  };
}

function normalizeOrderStatus(status: string): OrderStatus {
  if (
    status === "New" ||
    status === "Processing" ||
    status === "Packed" ||
    status === "Shipped" ||
    status === "Delivered" ||
    status === "Refund review" ||
    status === "Failed" ||
    status === "Cancelled"
  ) {
    return status;
  }
  return "Processing";
}

function normalizePaymentStatus(status: string): PaymentStatus {
  if (status === "Paid" || status === "Authorized" || status === "Refunded" || status === "Failed") {
    return status;
  }
  return "Authorized";
}
