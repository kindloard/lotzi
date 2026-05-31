import { apiFetch } from "@/lib/api";

interface MerchantDashboardRequestOptions {
  signal?: AbortSignal;
}

export interface MerchantDashboardBootstrap {
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  };
  store: {
    id: string;
    name: string;
    slug: string;
    status: string;
    logoUrl: string | null;
  };
  membership: {
    roleCode: string;
    roleName: string;
  };
}

export interface MerchantStoreLocation {
  id: string;
  name: string;
  slug: string;
  status: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
  googleMapsUrl: string | null;
  updatedAt: string;
}

export interface UpdateMerchantStoreLocationPayload {
  latitude: number;
  longitude: number;
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface MerchantDashboardOrder {
  id: string;
  customer: string;
  email: string;
  total: number;
  items: number;
  lineItems: MerchantDashboardOrderLineItem[];
  status: string;
  payment: string;
  channel: string;
  city: string;
  placedAt: string;
  timeline: Array<{ label: string; at: string }>;
}

export interface MerchantDashboardOrderLineItem {
  id: string;
  name: string;
  variantName: string | null;
  unitDisplay: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
  imageUrl: string | null;
  sku: string | null;
}

export interface MerchantOrderStatusUpdatePayload {
  orderIds: string[];
  action: "MARK_PACKED" | "MOVE_TO_REFUND_REVIEW";
}

export function fetchMerchantDashboardBootstrap(options: MerchantDashboardRequestOptions = {}) {
  return apiFetch<MerchantDashboardBootstrap>("/merchant/dashboard/bootstrap", {
    signal: options.signal
  });
}

export function fetchMerchantOrders(options: MerchantDashboardRequestOptions = {}) {
  return apiFetch<{ apiVersion: "v1"; orders: MerchantDashboardOrder[] }>("/merchant/dashboard/orders", {
    signal: options.signal
  });
}

export function fetchMerchantOrder(orderId: string, options: MerchantDashboardRequestOptions = {}) {
  return apiFetch<{ apiVersion: "v1"; order: MerchantDashboardOrder }>(`/merchant/dashboard/orders/${encodeURIComponent(orderId)}`, {
    signal: options.signal
  });
}

export function updateMerchantOrderStatuses(payload: MerchantOrderStatusUpdatePayload) {
  return apiFetch<{
    apiVersion: "v1";
    updated: MerchantDashboardOrder[];
    updatedCount: number;
    skipped: Array<{ id: string; reason: string; status?: string }>;
  }>("/merchant/dashboard/orders/status", {
    body: JSON.stringify(payload),
    method: "PATCH"
  });
}

export function fetchMerchantStoreLocation(options: MerchantDashboardRequestOptions = {}) {
  return apiFetch<MerchantStoreLocation>("/merchant/dashboard/settings/location", {
    signal: options.signal
  });
}

export function updateMerchantStoreLocation(payload: UpdateMerchantStoreLocationPayload) {
  return apiFetch<MerchantStoreLocation>("/merchant/dashboard/settings/location", {
    body: JSON.stringify(payload),
    method: "PATCH"
  });
}
