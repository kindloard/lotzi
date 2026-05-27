import { HttpStatus, Injectable } from "@nestjs/common";
import { StockReservationStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { uploadError } from "../uploads/uploads.errors";
import { availableStock } from "./product-measurement";

const DEFAULT_RESERVATION_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class ProductInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async reserveStock(input: {
    userId: string;
    variantId: string;
    quantity: number;
    ttlMs?: number;
  }) {
    const quantity = assertPositiveInteger(input.quantity);
    const expiresAt = new Date(Date.now() + (input.ttlMs ?? DEFAULT_RESERVATION_TTL_MS));

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.$executeRaw`
        UPDATE product_variants
        SET stock_reserved = stock_reserved + ${quantity},
            stock_version = stock_version + 1,
            updated_at = now()
        WHERE id = ${input.variantId}::uuid
          AND stock_on_hand - stock_reserved >= ${quantity}
      `;

      if (updated !== 1) {
        const variant = await tx.productVariant.findUnique({
          where: { id: input.variantId },
          select: { stockOnHand: true, stockReserved: true }
        });
        throw uploadError(
          HttpStatus.CONFLICT,
          "PRODUCT_VARIANT_OUT_OF_STOCK",
          variant ? `Only ${availableStock(variant.stockOnHand, variant.stockReserved)} left.` : "Variant is out of stock.",
          false,
          { available: variant ? availableStock(variant.stockOnHand, variant.stockReserved) : 0 }
        );
      }

      return tx.stockReservation.create({
        data: {
          userId: input.userId,
          productVariantId: input.variantId,
          quantity,
          status: StockReservationStatus.ACTIVE,
          expiresAt
        }
      });
    });
  }

  async releaseReservation(reservationId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.stockReservation.findUnique({ where: { id: reservationId } });
      if (!reservation || reservation.status !== StockReservationStatus.ACTIVE) {
        return reservation;
      }

      await tx.$executeRaw`
        UPDATE product_variants
        SET stock_reserved = GREATEST(stock_reserved - ${reservation.quantity}, 0),
            stock_version = stock_version + 1,
            updated_at = now()
        WHERE id = ${reservation.productVariantId}::uuid
      `;

      return tx.stockReservation.update({
        where: { id: reservationId },
        data: {
          status: StockReservationStatus.RELEASED,
          reason,
          releasedAt: new Date()
        }
      });
    });
  }

  async finalizeReservation(reservationId: string, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.stockReservation.findUnique({ where: { id: reservationId } });
      if (!reservation || reservation.status !== StockReservationStatus.ACTIVE) {
        throw uploadError(
          HttpStatus.CONFLICT,
          "PRODUCT_STOCK_RESERVATION_EXPIRED",
          "This stock reservation is no longer active.",
          false,
          { reservationId }
        );
      }

      const updated = await tx.$executeRaw`
        UPDATE product_variants
        SET stock_on_hand = stock_on_hand - ${reservation.quantity},
            stock_reserved = GREATEST(stock_reserved - ${reservation.quantity}, 0),
            stock = GREATEST(stock_on_hand - ${reservation.quantity}, 0),
            stock_version = stock_version + 1,
            updated_at = now()
        WHERE id = ${reservation.productVariantId}::uuid
          AND stock_on_hand >= ${reservation.quantity}
          AND stock_reserved >= ${reservation.quantity}
      `;

      if (updated !== 1) {
        throw uploadError(
          HttpStatus.CONFLICT,
          "PRODUCT_VARIANT_OUT_OF_STOCK",
          "Stock changed before payment could be finalized.",
          false,
          { reservationId }
        );
      }

      return tx.stockReservation.update({
        where: { id: reservationId },
        data: {
          orderId,
          status: StockReservationStatus.FINALIZED,
          finalizedAt: new Date()
        }
      });
    });
  }

  async expireReservations(limit = 100) {
    const reservations = await this.prisma.stockReservation.findMany({
      where: {
        status: StockReservationStatus.ACTIVE,
        expiresAt: { lt: new Date() }
      },
      orderBy: { expiresAt: "asc" },
      take: limit
    });

    for (const reservation of reservations) {
      await this.releaseReservation(reservation.id, "reservation_ttl_expired");
      await this.prisma.stockReservation.updateMany({
        where: { id: reservation.id, status: StockReservationStatus.RELEASED },
        data: { status: StockReservationStatus.EXPIRED }
      });
    }

    return { expired: reservations.length };
  }
}

function assertPositiveInteger(value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw uploadError(
      HttpStatus.BAD_REQUEST,
      "PRODUCT_UNIT_QUANTITY_INVALID",
      "Quantity must be a positive whole number.",
      false,
      { quantity: value }
    );
  }
  return value;
}
