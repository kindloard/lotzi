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

export function fetchMerchantDashboardBootstrap(options: MerchantDashboardRequestOptions = {}) {
  return apiFetch<MerchantDashboardBootstrap>("/merchant/dashboard/bootstrap", {
    signal: options.signal
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
