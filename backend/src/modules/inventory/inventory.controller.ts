import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/auth.types";
import { AccessTokenGuard } from "../auth/guards/access-token.guard";
import { CsrfGuard } from "../auth/guards/csrf.guard";
import { RequirePermissions } from "../rbac/require-permissions.decorator";
import { RbacGuard } from "../rbac/rbac.guard";
import { PERMISSIONS } from "../rbac/permissions";
import { InventoryAdjustmentDto } from "./dto/inventory.dto";
import { InventoryService } from "./inventory.service";

@Controller("v1/inventory")
@UseGuards(AccessTokenGuard, RbacGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get(":storeId")
  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  list(@Param("storeId") storeId: string, @Query("productVariantId") productVariantId?: string) {
    return this.inventory.listStoreInventory(storeId, productVariantId);
  }

  @Get(":storeId/reservations")
  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  reservations(@Param("storeId") storeId: string, @Query("orderId") orderId?: string) {
    return this.inventory.listReservations(storeId, orderId);
  }

  @Get(":storeId/ledger")
  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  ledger(
    @Param("storeId") storeId: string,
    @Query("productVariantId") productVariantId?: string,
    @Query("orderId") orderId?: string
  ) {
    return this.inventory.listLedger(storeId, { productVariantId, orderId });
  }

  @Post("adjustments")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.PRODUCT_MANAGE)
  adjust(@Req() request: AuthenticatedRequest, @Body() dto: InventoryAdjustmentDto) {
    return this.inventory.applyManualAdjustment({
      ...dto,
      actorUserId: request.auth!.userId,
      requestId: request.requestId
    });
  }
}
