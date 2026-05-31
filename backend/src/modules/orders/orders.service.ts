import { HttpStatus, Injectable } from "@nestjs/common";
import { OrderStatus, PaymentStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { AuthenticatedPrincipal } from "../auth/auth.types";
import { InventoryService } from "../inventory/inventory.service";
import { PaymentTransitionService } from "../payments/payment-transition.service";
import { paymentError } from "../payments/payment.errors";

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly transitions: PaymentTransitionService
  ) {}

  async cancel(auth: AuthenticatedPrincipal, orderId: string, requestId?: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId: auth.userId },
      include: { payment: true }
    });
    if (!order) {
      throw paymentError(HttpStatus.NOT_FOUND, "ORDER_NOT_FOUND", "Order not found.");
    }
    if (order.paymentStatus === PaymentStatus.PAID) {
      throw paymentError(HttpStatus.CONFLICT, "ORDER_REFUND_REQUIRED", "Paid orders require a refund workflow.");
    }
    const cancellableStatuses = new Set<OrderStatus>([
      OrderStatus.PENDING_PAYMENT,
      OrderStatus.FULFILLMENT_READY,
      OrderStatus.ACCEPTED,
      OrderStatus.PACKING
    ]);
    if (!cancellableStatuses.has(order.status)) {
      throw paymentError(HttpStatus.CONFLICT, "ORDER_CANCEL_NOT_ALLOWED", "This order cannot be cancelled.");
    }

    await this.prisma.$transaction(async (tx) => {
      await this.inventory.releaseOrderStock(tx, {
        storeId: order.storeId,
        orderId: order.id,
        reason: "customer_cancelled",
        idempotencyKey: `order-cancel:${order.id}`,
        actorType: "CUSTOMER",
        actorUserId: auth.userId,
        requestId
      });
      await this.transitions.transitionOrder(tx, {
        orderId: order.id,
        from: order.status,
        to: OrderStatus.CANCELLED,
        context: { reason: "customer_cancelled", requestId, actorType: "CUSTOMER", actorUserId: auth.userId }
      });
      if (order.payment && order.payment.status !== PaymentStatus.EXPIRED && order.payment.status !== PaymentStatus.FAILED) {
        await this.transitions.transitionPayment(tx, {
          paymentId: order.payment.id,
          orderId: order.id,
          from: order.payment.status,
          to: PaymentStatus.EXPIRED,
          context: { reason: "order_cancelled", requestId, actorType: "CUSTOMER", actorUserId: auth.userId }
        });
      }
      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: PaymentStatus.EXPIRED }
      });
    });

    return { apiVersion: "v1", status: "CANCELLED", orderId: order.id };
  }
}
