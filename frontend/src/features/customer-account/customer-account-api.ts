import { apiFetch } from "@/lib/api";

export interface AccountBootstrap {
  apiVersion: "v1";
  account: {
    id: string;
    email: string;
    fullName: string | null;
    avatarUrl: string | null;
    emailVerified: boolean;
    profileVersion: string;
  };
  sections: string[];
  summary: {
    addresses: number;
    orders: number;
    activeSessions: number;
    activity: number;
  };
  cache: {
    generatedAt: string;
    maxAgeSeconds: number;
  };
}

export interface CustomerProfile {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  emailVerified: boolean;
  marketingOptIn: boolean;
  loyaltyTier: string;
  providerType: string;
  createdAt: string;
  updatedAt: string;
  profileVersion: string;
}

export interface CustomerAddress {
  id: string;
  label: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  deliveryInstructions: string | null;
  isDefault: boolean;
  addressVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerOrder {
  id: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  customerNote: string | null;
  createdAt: string;
  updatedAt: string;
  store: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string | null;
  };
  address: {
    recipientName: string | null;
    recipientPhone: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  };
  payment: {
    id: string;
    method: string;
    status: string;
    amount: number;
    createdAt: string;
  } | null;
  items: Array<{
    id: string;
    productId: string;
    variantId: string | null;
    name: string;
    variantName: string | null;
    unitDisplay: string | null;
    quantity: number;
    unitPrice: number;
    mrp: number | null;
    total: number;
  }>;
}

export interface CustomerSession {
  id: string;
  deviceLabel: string;
  browser: string;
  os: string;
  timezone: string | null;
  language: string | null;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface AccountActivity {
  id: string;
  type: string;
  category: string;
  summary: string;
  outcome: string;
  createdAt: string;
}

export type AddressInput = {
  label?: string;
  recipientName?: string;
  recipientPhone?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  deliveryInstructions?: string;
  isDefault?: boolean;
};

export function fetchAccountBootstrap() {
  return apiFetch<AccountBootstrap>("/v1/me/bootstrap");
}

export function fetchCustomerProfile() {
  return apiFetch<{ apiVersion: "v1"; profile: CustomerProfile }>("/v1/me/profile");
}

export function updateCustomerProfile(input: {
  profileVersion: string;
  fullName?: string;
  phone?: string | null;
  marketingOptIn?: boolean;
}) {
  return apiFetch<{ apiVersion: "v1"; profile: CustomerProfile }>("/v1/me/profile", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function uploadCustomerAvatar(file: File) {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<{ apiVersion: "v1"; profile: CustomerProfile }>("/v1/me/avatar", {
    method: "POST",
    body: form
  });
}

export function fetchCustomerAddresses() {
  return apiFetch<{ apiVersion: "v1"; addresses: CustomerAddress[] }>("/v1/me/addresses");
}

export function createCustomerAddress(input: AddressInput) {
  return apiFetch<{ apiVersion: "v1"; address: CustomerAddress }>("/v1/me/addresses", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateCustomerAddress(id: string, input: AddressInput & { addressVersion: number }) {
  return apiFetch<{ apiVersion: "v1"; address: CustomerAddress }>(`/v1/me/addresses/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function deleteCustomerAddress(id: string) {
  return apiFetch<{ apiVersion: "v1"; status: string }>(`/v1/me/addresses/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function setDefaultCustomerAddress(id: string) {
  return apiFetch<{ apiVersion: "v1"; address: CustomerAddress }>(`/v1/me/addresses/${encodeURIComponent(id)}/default`, {
    method: "POST"
  });
}

export function fetchCustomerOrders(cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiFetch<{ apiVersion: "v1"; orders: CustomerOrder[]; nextCursor: string | null }>(`/v1/me/orders${query}`);
}

export function fetchCustomerSessions() {
  return apiFetch<{ apiVersion: "v1"; sessions: CustomerSession[] }>("/v1/me/sessions");
}

export function revokeCustomerSession(id: string) {
  return apiFetch<{ apiVersion: "v1"; status: string; currentSessionRevoked: boolean }>(`/v1/me/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function revokeOtherCustomerSessions() {
  return apiFetch<{ apiVersion: "v1"; status: string; revokedCount: number }>("/v1/me/sessions", {
    method: "DELETE"
  });
}

export function changeCustomerPassword(input: { currentPassword: string; newPassword: string }) {
  return apiFetch<{ apiVersion: "v1"; status: string; revokedOtherSessions: number }>("/v1/me/security/password", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export function requestCustomerEmailChange(input: { newEmail: string; currentPassword: string }) {
  return apiFetch<{ apiVersion: "v1"; status: string; email: string; cooldownUntil?: string }>("/v1/me/email-change/request", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function confirmCustomerEmailChange(input: { newEmail: string; otp: string }) {
  return apiFetch<{ apiVersion: "v1"; profile: CustomerProfile }>("/v1/me/email-change/confirm", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function fetchAccountActivity() {
  return apiFetch<{ apiVersion: "v1"; activity: AccountActivity[] }>("/v1/me/activity");
}

export function requestDeleteAccount() {
  return apiFetch<{ apiVersion: "v1"; status: string; cooldownUntil?: string }>("/v1/me/delete-request", {
    method: "POST"
  });
}

export function deleteCustomerAccount(input: { currentPassword?: string; otp?: string }) {
  return apiFetch<{ apiVersion: "v1"; status: string }>("/v1/me", {
    method: "DELETE",
    body: JSON.stringify(input)
  });
}
