import { apiFetch, apiFetchWithMeta } from "@/lib/api";

export interface CheckoutCartItemInput {
  productId: string;
  variantId: string;
  quantity: number;
}

export interface CheckoutSessionResponse {
  apiVersion: "v1";
  status: "SESSION_CREATED" | "UNKNOWN_GATEWAY" | "COD_CONFIRMED";
  provider?: "cashfree" | "phonepe" | "cod";
  orderId: string;
  paymentId: string;
  attemptId?: string;
  cashfreeOrderId?: string;
  merchantOrderId?: string;
  paymentSessionId?: string;
  redirectUrl?: string;
  retryAfterSeconds?: number;
  message?: string;
  totals?: {
    currency: string;
    subtotal: number;
    discount: number;
    tax: number;
    deliveryFee: number;
    grandTotal: number;
    subtotalPaise: string;
    discountPaise: string;
    taxPaise: string;
    deliveryFeePaise: string;
    grandTotalPaise: string;
  };
  expiresAt?: string;
}

export interface PaymentStatusResponse {
  apiVersion: "v1";
  payment: {
    id: string;
    orderId: string;
    method: string;
    provider: string;
    status: string;
    orderStatus: string;
    paymentStatus: string;
    amount: number;
    amountPaise: string;
    currency: string;
    phonepeTransactionId?: string | null;
    expiresAt: string | null;
    verifiedAt: string | null;
    attempt: {
      id: string;
      attemptNumber: number;
      status: string;
      expiresAt: string | null;
    } | null;
  };
  recovery: {
    action: "POLL" | "RETRY" | "NEW_CHECKOUT" | "TRACK_ORDER" | "WAIT_RECONCILIATION" | "CONTACT_SUPPORT";
    pollAfterMs: number | null;
  };
}

export interface CheckoutMethod {
  key: "cashfree" | "phonepe" | "cod";
  name: string;
  enabled: boolean;
  priority: number;
}

export interface CheckoutMethodsResponse {
  apiVersion: "v1";
  methods: CheckoutMethod[];
}

export function getCheckoutMethods(storeId?: string) {
  const query = storeId ? `?${new URLSearchParams({ storeId }).toString()}` : "";
  return apiFetch<CheckoutMethodsResponse>(`/v1/checkout/methods${query}`);
}

export function createCheckoutSession(input: {
  items: CheckoutCartItemInput[];
  addressId?: string;
  shippingOption: "standard" | "priority";
  couponCode?: string;
  paymentMethod?: CheckoutMethod["key"];
  idempotencyKey: string;
}) {
  return apiFetch<CheckoutSessionResponse>("/v1/checkout/session", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function createCheckoutSessionWithMeta(input: {
  items: CheckoutCartItemInput[];
  addressId?: string;
  shippingOption: "standard" | "priority";
  couponCode?: string;
  paymentMethod?: CheckoutMethod["key"];
  idempotencyKey: string;
}) {
  return apiFetchWithMeta<CheckoutSessionResponse>("/v1/checkout/session", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getPaymentStatus(paymentId: string) {
  return apiFetch<PaymentStatusResponse>(`/v1/payments/${paymentId}/status`);
}

export function verifyPayment(paymentId: string) {
  return apiFetch<PaymentStatusResponse>(`/v1/payments/${paymentId}/verify`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function retryPayment(paymentId: string, idempotencyKey: string) {
  return apiFetch<CheckoutSessionResponse>(`/v1/payments/${paymentId}/retry`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey })
  });
}
