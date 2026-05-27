import type { NavId, OrderStatus, PaymentStatus, ProductImage, ProductStatus } from "../types/dashboard";

export const navTranslationKeys: Record<NavId, string> = {
  dashboard: "nav.overview",
  products: "nav.products",
  orders: "nav.orders",
  analytics: "nav.analytics",
  customers: "nav.customers",
  inventory: "nav.inventory",
  payments: "nav.payments",
  settings: "nav.settings"
};

const statusTranslationKeys: Record<string, string> = {
  All: "status.all",
  Published: "status.published",
  Draft: "status.draft",
  Paused: "status.paused",
  "Needs review": "status.needsReview",
  New: "status.new",
  Processing: "status.processing",
  Packed: "status.packed",
  Shipped: "status.shipped",
  Delivered: "status.delivered",
  "Refund review": "status.refundReview",
  Paid: "status.paid",
  Authorized: "status.authorized",
  Refunded: "status.refunded",
  Failed: "status.failed",
  Active: "status.active",
  Completed: "status.completed",
  Cancelled: "status.cancelled"
};

export const productStatusValues: Array<ProductStatus | "All"> = ["All", "Published", "Draft", "Needs review"];
export const orderStatusValues: Array<OrderStatus | "All"> = [
  "All",
  "New",
  "Processing",
  "Packed",
  "Shipped",
  "Delivered",
  "Refund review"
];

export function dashboardStatusKey(status: ProductStatus | OrderStatus | PaymentStatus | "All" | string) {
  return statusTranslationKeys[status] ?? null;
}

export function dashboardStatusTone(status: ProductStatus | OrderStatus | PaymentStatus | string) {
  if (["Published", "Paid", "Delivered", "Active", "Completed"].includes(status)) {
    return "success";
  }
  if (["Refund review", "Failed", "Cancelled"].includes(status)) {
    return "danger";
  }
  if (["Needs review", "Authorized", "New", "Processing", "Packed", "Shipped", "Draft", "Paused"].includes(status)) {
    return "warning";
  }
  return "neutral";
}

export function timelineEventKey(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes("created") || normalized.includes("placed")) return "orders.timeline.created";
  if (normalized.includes("payment")) return "orders.timeline.paymentConfirmed";
  if (normalized.includes("packed")) return "orders.timeline.packed";
  if (normalized.includes("shipped")) return "orders.timeline.shipped";
  if (normalized.includes("delivered")) return "orders.timeline.delivered";
  if (normalized.includes("refund")) return "orders.timeline.refundRequested";
  return "orders.timeline.default";
}

export function uploadStatusKey(status?: NonNullable<ProductImage["upload"]>["status"]) {
  if (!status) return "productCreate.media.statuses.ready";
  return `productCreate.media.statuses.${status}`;
}
