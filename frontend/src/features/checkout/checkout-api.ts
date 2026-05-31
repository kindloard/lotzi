import { apiFetch } from "@/lib/api";

export interface CheckoutCartItemInput {
  productId: string;
  variantId: string;
  quantity: number;
}

export interface CheckoutSessionResponse {
  apiVersion: "v1";
  status: "SESSION_CREATED" | "UNKNOWN_GATEWAY";
  orderId: string;
  paymentId: string;
  attemptId?: string;
  cashfreeOrderId?: string;
  paymentSessionId?: string;
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
    status: string;
    orderStatus: string;
    paymentStatus: string;
    amount: number;
    amountPaise: string;
    currency: string;
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

export function createCheckoutSession(input: {
  items: CheckoutCartItemInput[];
  addressId?: string;
  shippingOption: "standard" | "priority";
  couponCode?: string;
  idempotencyKey: string;
}) {
  return apiFetch<CheckoutSessionResponse>("/v1/checkout/session", {
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
