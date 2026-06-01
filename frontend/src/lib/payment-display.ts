export interface PaymentDisplaySnapshot {
  method?: string | null;
  provider?: string | null;
  status?: string | null;
}

const FAILURE_STATUSES = new Set([
  "FAILED",
  "EXPIRED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "DUPLICATE_SUCCESS_REQUIRES_REFUND",
  "INVENTORY_CONFIRMATION_REQUIRES_REVIEW"
]);

const TERMINAL_STATUSES = new Set([
  "PAID",
  "AUTHORIZED",
  ...FAILURE_STATUSES
]);

export function paymentToken(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

export function isCodPayment(payment: PaymentDisplaySnapshot | null | undefined) {
  return paymentToken(payment?.method) === "COD" || paymentToken(payment?.provider) === "COD";
}

export function isCheckoutSuccessPayment(payment: PaymentDisplaySnapshot | null | undefined) {
  const status = paymentToken(payment?.status);
  return status === "PAID" || status === "AUTHORIZED";
}

export function isCheckoutFailedPayment(payment: PaymentDisplaySnapshot | null | undefined) {
  return FAILURE_STATUSES.has(paymentToken(payment?.status));
}

export function isCheckoutTerminalPayment(payment: PaymentDisplaySnapshot | null | undefined) {
  const status = paymentToken(payment?.status);
  return isCheckoutSuccessPayment(payment) || TERMINAL_STATUSES.has(status);
}

export function checkoutPaymentStatusLabel(payment: PaymentDisplaySnapshot | null | undefined) {
  const status = paymentToken(payment?.status);
  if (!status) return "Pending";
  if (isCodPayment(payment) && status === "AUTHORIZED") return "COD confirmed";
  if (status === "PAID") return "Paid";
  if (status === "AUTHORIZED") return "Authorized";
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function checkoutPaymentMethodLabel(payment: PaymentDisplaySnapshot | null | undefined) {
  const method = paymentToken(payment?.method || payment?.provider);
  if (method === "COD") return "Cash on delivery";
  if (method === "PHONEPE") return "PhonePe";
  if (method === "CASHFREE") return "Cashfree";
  return method || "Payment";
}

export function checkoutPaymentSummary(payment: PaymentDisplaySnapshot | null | undefined) {
  const method = checkoutPaymentMethodLabel(payment);
  if (isCodPayment(payment) && paymentToken(payment?.status) === "AUTHORIZED") {
    return `${method} - collect on delivery`;
  }
  return `${method} - ${checkoutPaymentStatusLabel(payment)}`;
}
