import { OrderStatus, PaymentStatus } from "@prisma/client";
import { assertOrderTransition, assertPaymentTransition } from "../../modules/payments/payment-state.machine";

describe("payment state machine", () => {
  it("allows verified gateway success from pending gateway to paid", () => {
    expect(() => assertPaymentTransition(PaymentStatus.PENDING_GATEWAY, PaymentStatus.PAID)).not.toThrow();
  });

  it("blocks duplicate terminal resurrection", () => {
    expect(() => assertPaymentTransition(PaymentStatus.REFUNDED, PaymentStatus.PAID)).toThrow(
      /Payment cannot move/
    );
  });

  it("routes late gateway success after released terminal states to refund reconciliation", () => {
    expect(() => assertPaymentTransition(
      PaymentStatus.FAILED,
      PaymentStatus.DUPLICATE_SUCCESS_REQUIRES_REFUND
    )).not.toThrow();
    expect(() => assertPaymentTransition(
      PaymentStatus.EXPIRED,
      PaymentStatus.DUPLICATE_SUCCESS_REQUIRES_REFUND
    )).not.toThrow();
    expect(() => assertPaymentTransition(PaymentStatus.FAILED, PaymentStatus.PAID)).toThrow(
      /Payment cannot move/
    );
  });

  it("routes paid webhooks with inactive reservations to inventory review", () => {
    expect(() => assertPaymentTransition(
      PaymentStatus.PENDING_GATEWAY,
      PaymentStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW
    )).not.toThrow();
    expect(() => assertPaymentTransition(
      PaymentStatus.UNKNOWN_GATEWAY,
      PaymentStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW
    )).not.toThrow();
    expect(() => assertPaymentTransition(
      PaymentStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW,
      PaymentStatus.DUPLICATE_SUCCESS_REQUIRES_REFUND
    )).not.toThrow();
  });
});

describe("order state machine", () => {
  it("allows paid orders to become fulfillment ready after inventory finalization", () => {
    expect(() => assertOrderTransition(OrderStatus.PAYMENT_CONFIRMED, OrderStatus.FULFILLMENT_READY)).not.toThrow();
  });

  it("blocks fulfillment before payment confirmation", () => {
    expect(() => assertOrderTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.FULFILLMENT_READY)).toThrow(
      /Order cannot move/
    );
  });

  it("allows pending payment orders to enter inventory review", () => {
    expect(() => assertOrderTransition(
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW
    )).not.toThrow();
    expect(() => assertOrderTransition(
      OrderStatus.INVENTORY_CONFIRMATION_REQUIRES_REVIEW,
      OrderStatus.REFUND_PENDING
    )).not.toThrow();
  });
});
