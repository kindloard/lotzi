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

export function fetchMerchantDashboardBootstrap(options: MerchantDashboardRequestOptions = {}) {
  return apiFetch<MerchantDashboardBootstrap>("/merchant/dashboard/bootstrap", {
    signal: options.signal
  });
}
