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
});
