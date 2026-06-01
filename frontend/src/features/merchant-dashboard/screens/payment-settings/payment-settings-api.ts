import { apiFetch } from "@/lib/api";

export type PaymentProviderKey = "cashfree" | "phonepe" | "cod";

export interface PaymentProviderSettings {
  provider: PaymentProviderKey;
  enabled: boolean;
  configured: boolean;
  readonly: boolean;
  displayName: string;
  displayPriority: number;
  environment?: "SANDBOX" | "PRODUCTION" | string;
  merchantId?: string;
  clientVersion?: string;
  saltIndex?: string;
  secrets?: {
    clientId: string;
    clientSecret: string;
    saltKey: string;
  };
  lastTestedAt?: string | null;
  updatedAt?: string | null;
}

export interface PaymentSettingsResponse {
  apiVersion: "v1";
  storeId: string;
  providers: PaymentProviderSettings[];
  auditTrail: Array<{
    id: string;
    action: string;
    actorUserId: string | null;
    details: unknown;
    createdAt: string;
  }>;
}

export interface PhonepeSettingsInput {
  enabled: boolean;
  displayName: string;
  displayPriority: number;
  merchantId: string;
  clientId?: string;
  clientSecret?: string;
  clientVersion: string;
  saltKey?: string;
  saltIndex?: string;
  environment: "SANDBOX" | "PRODUCTION";
}

export interface CodSettingsInput {
  enabled: boolean;
  displayName: string;
  displayPriority: number;
}

export function fetchPaymentSettings(storeId: string) {
  return apiFetch<PaymentSettingsResponse>(`/v1/stores/${storeId}/payment-settings`);
}

export function updatePhonepeSettings(storeId: string, input: PhonepeSettingsInput) {
  return apiFetch<{ apiVersion: "v1"; provider: PaymentProviderSettings }>(`/v1/stores/${storeId}/payment-settings/phonepe`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function testPhonepeConnection(storeId: string) {
  return apiFetch<{ apiVersion: "v1"; status: "success" | "error"; message: string }>(
    `/v1/stores/${storeId}/payment-settings/phonepe/test`,
    {
      method: "POST",
      body: JSON.stringify({})
    }
  );
}

export function updateCodSettings(storeId: string, input: CodSettingsInput) {
  return apiFetch<{ apiVersion: "v1"; provider: PaymentProviderSettings }>(`/v1/stores/${storeId}/payment-settings/cod`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}
