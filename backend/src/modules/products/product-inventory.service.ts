import { HttpStatus, Injectable } from "@nestjs/common";
import { InventoryService } from "../inventory/inventory.service";
import { uploadError } from "../uploads/uploads.errors";

@Injectable()
export class ProductInventoryService {
  constructor(private readonly inventory: InventoryService) {}

  async reserveStock(input: {
    userId: string;
    variantId: string;
    quantity: number;
    ttlMs?: number;
  }) {
    void input;
    throw deprecatedInventoryError();
  }

  async releaseReservation(reservationId: string, reason: string) {
    void reservationId;
    void reason;
    throw deprecatedInventoryError();
  }

  async finalizeReservation(reservationId: string, orderId: string) {
    void reservationId;
    void orderId;
    throw deprecatedInventoryError();
  }

  async expireReservations(limit = 100) {
    return this.inventory.expireReservations(limit);
  }
}

function deprecatedInventoryError() {
  return uploadError(
    HttpStatus.GONE,
    "PRODUCT_INVENTORY_API_DEPRECATED",
    "Stock mutations must use the order-scoped InventoryService reservation engine.",
    false
  );
}
