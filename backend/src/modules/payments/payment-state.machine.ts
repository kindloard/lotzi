import { HttpStatus } from "@nestjs/common";
import { OrderStatus, PaymentStatus } from "@prisma/client";
import { paymentError } from "./payment.errors";

const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [
    PaymentStatus.INITIATED,
    PaymentStatus.SESSION_CREATED,
    PaymentStatus.PENDING_GATEWAY,
    PaymentStatus.FAILED
  ],
  [PaymentStatus.INITIATED]: [
    PaymentStatus.SESSION_CREATED,
    PaymentStatus.FAILED,
    PaymentStatus.EXPIRED,
    PaymentStatus.UNKNOWN_GATEWAY
  ],
  [PaymentStatus.SESSION_CREATED]: [
    PaymentStatus.PENDING_GATEWAY,
    PaymentStatus.FAILED,
    PaymentStatus.EXPIRED,
    PaymentStatus.UNKNOWN_GATEWAY
  ],
  [PaymentStatus.PENDING_GATEWAY]: [
    PaymentStatus.AUTHORIZED,
    PaymentStatus.PAID,
    PaymentStatus.FAILED,
    PaymentStatus.USER_DROPPED,
    PaymentStatus.EXPIRED,
    PaymentStatus.UNKNOWN_GATEWAY
  ],
  [PaymentStatus.AUTHORIZED]: [PaymentStatus.PAID, PaymentStatus.FAILED, PaymentStatus.EXPIRED],
  [PaymentStatus.PAID]: [
    PaymentStatus.REFUND_PENDING,
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
    PaymentStatus.CHARGEBACK_OPENED,
    PaymentStatus.DUPLICATE_SUCCESS_REQUIRES_REFUND
  ],
  [PaymentStatus.FAILED]: [],
  [PaymentStatus.USER_DROPPED]: [PaymentStatus.INITIATED, PaymentStatus.SESSION_CREATED, PaymentStatus.PENDING_GATEWAY, PaymentStatus.EXPIRED],
  [PaymentStatus.EXPIRED]: [],
  [PaymentStatus.UNKNOWN_GATEWAY]: [
    PaymentStatus.PENDING_GATEWAY,
    PaymentStatus.PAID,
    PaymentStatus.FAILED,
    PaymentStatus.EXPIRED
  ],
  [PaymentStatus.REFUND_PENDING]: [
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
    PaymentStatus.PAID,
    PaymentStatus.FAILED
  ],
  [PaymentStatus.PARTIALLY_REFUNDED]: [PaymentStatus.REFUND_PENDING, PaymentStatus.REFUNDED],
  [PaymentStatus.REFUNDED]: [],
  [PaymentStatus.CHARGEBACK_OPENED]: [PaymentStatus.REFUND_PENDING, PaymentStatus.REFUNDED],
  [PaymentStatus.DUPLICATE_SUCCESS_REQUIRES_REFUND]: [PaymentStatus.REFUND_PENDING, PaymentStatus.REFUNDED]
};

const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [
    OrderStatus.PENDING_PAYMENT,
    OrderStatus.PAYMENT_CONFIRMED,
    OrderStatus.PAYMENT_FAILED,
    OrderStatus.CANCELLED
  ],
  [OrderStatus.PENDING_PAYMENT]: [
    OrderStatus.PAYMENT_CONFIRMED,
    OrderStatus.PAYMENT_FAILED,
    OrderStatus.EXPIRED,
    OrderStatus.CANCELLED
  ],
  [OrderStatus.PAYMENT_CONFIRMED]: [OrderStatus.FULFILLMENT_READY, OrderStatus.REFUND_PENDING],
  [OrderStatus.PAYMENT_FAILED]: [],
  [OrderStatus.FULFILLMENT_READY]: [OrderStatus.ACCEPTED, OrderStatus.CANCELLED, OrderStatus.REFUND_PENDING],
  [OrderStatus.ACCEPTED]: [OrderStatus.PACKING, OrderStatus.CANCELLED],
  [OrderStatus.REJECTED]: [],
  [OrderStatus.PACKING]: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.CANCELLED],
  [OrderStatus.OUT_FOR_DELIVERY]: [OrderStatus.DELIVERED, OrderStatus.RETURN_REQUESTED],
  [OrderStatus.DELIVERED]: [OrderStatus.RETURN_REQUESTED, OrderStatus.REFUND_PENDING],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.EXPIRED]: [],
  [OrderStatus.REFUND_PENDING]: [OrderStatus.CANCELLED],
  [OrderStatus.RETURN_REQUESTED]: [OrderStatus.REFUND_PENDING]
};

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus) {
  if (from === to) {
    return;
  }
  if (!PAYMENT_TRANSITIONS[from]?.includes(to)) {
    throw paymentError(
      HttpStatus.CONFLICT,
      "PAYMENT_STATE_TRANSITION_INVALID",
      `Payment cannot move from ${from} to ${to}.`,
      false,
      { from, to }
    );
  }
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus) {
  if (from === to) {
    return;
  }
  if (!ORDER_TRANSITIONS[from]?.includes(to)) {
    throw paymentError(
      HttpStatus.CONFLICT,
      "ORDER_STATE_TRANSITION_INVALID",
      `Order cannot move from ${from} to ${to}.`,
      false,
      { from, to }
    );
  }
}

export function isTerminalPaymentStatus(status: PaymentStatus) {
  return PAYMENT_TRANSITIONS[status]?.length === 0;
}
