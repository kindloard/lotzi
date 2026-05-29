import { Injectable } from "@nestjs/common";
import { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";
import { assertOrderTransition, assertPaymentTransition } from "./payment-state.machine";

type Tx = Prisma.TransactionClient;

interface TransitionContext {
  reason: string;
  requestId?: string;
  actorType?: string;
  actorUserId?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class PaymentTransitionService {
  async transitionPayment(
    tx: Tx,
    input: {
      paymentId: string;
      orderId: string;
      attemptId?: string;
      from: PaymentStatus;
      to: PaymentStatus;
      context: TransitionContext;
    }
  ) {
    assertPaymentTransition(input.from, input.to);
    if (input.from === input.to) {
      return;
    }
    await tx.payment.update({
      where: { id: input.paymentId },
      data: {
        status: input.to,
        ...(input.to === PaymentStatus.PAID ? { verifiedAt: new Date() } : {}),
        ...(input.to === PaymentStatus.FAILED ? { failedAt: new Date() } : {})
      }
    });
    await tx.paymentEvent.create({
      data: {
        paymentId: input.paymentId,
        orderId: input.orderId,
        attemptId: input.attemptId,
        eventType: "payment.status.changed",
        schemaVersion: 1,
        fromStatus: input.from,
        toStatus: input.to,
        actorType: input.context.actorType ?? "SYSTEM",
        actorUserId: input.context.actorUserId,
        reason: input.context.reason,
        requestId: input.context.requestId,
        payload: (input.context.metadata ?? {}) as Prisma.InputJsonValue
      }
    });
  }

  async transitionOrder(
    tx: Tx,
    input: {
      orderId: string;
      from: OrderStatus;
      to: OrderStatus;
      context: TransitionContext;
    }
  ) {
    assertOrderTransition(input.from, input.to);
    if (input.from === input.to) {
      return;
    }
    await tx.order.update({
      where: { id: input.orderId },
      data: {
        status: input.to,
        ...(input.to === OrderStatus.PAYMENT_CONFIRMED ? { confirmedAt: new Date() } : {}),
        ...(input.to === OrderStatus.CANCELLED ? { cancelledAt: new Date() } : {})
      }
    });
    await tx.orderStateTransition.create({
      data: {
        orderId: input.orderId,
        fromStatus: input.from,
        toStatus: input.to,
        actorType: input.context.actorType ?? "SYSTEM",
        actorUserId: input.context.actorUserId,
        reason: input.context.reason,
        requestId: input.context.requestId,
        metadata: (input.context.metadata ?? {}) as Prisma.InputJsonValue
      }
    });
  }
}
