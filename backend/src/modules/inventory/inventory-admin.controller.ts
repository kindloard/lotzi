import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/auth.types";
import { AccessTokenGuard } from "../auth/guards/access-token.guard";
import { CsrfGuard } from "../auth/guards/csrf.guard";
import { RequirePermissions } from "../rbac/require-permissions.decorator";
import { PERMISSIONS } from "../rbac/permissions";
import { RbacGuard } from "../rbac/rbac.guard";
import { InventoryReconcileDto } from "./dto/inventory.dto";
import { InventoryService } from "./inventory.service";

@Controller("v1/admin/inventory")
@UseGuards(AccessTokenGuard, RbacGuard)
export class InventoryAdminController {
  constructor(private readonly inventory: InventoryService) {}

  @Post("reconcile")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.ADMIN_SYSTEM)
  reconcile(@Req() request: AuthenticatedRequest, @Body() dto: InventoryReconcileDto) {
    return this.inventory.reconcile(dto, {
      actor: "PLATFORM_ADMIN",
      actorUserId: request.auth!.userId,
      requestId: request.requestId
    });
  }
}
