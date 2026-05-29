import { Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/auth.types";
import { AccessTokenGuard } from "../auth/guards/access-token.guard";
import { CsrfGuard } from "../auth/guards/csrf.guard";
import { PERMISSIONS } from "../rbac/permissions";
import { RbacGuard } from "../rbac/rbac.guard";
import { RequirePermissions } from "../rbac/require-permissions.decorator";
import { OrdersService } from "./orders.service";

@Controller("v1/orders")
@UseGuards(AccessTokenGuard, RbacGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post(":orderId/cancel")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.ORDER_READ_OWN)
  cancel(@Req() request: AuthenticatedRequest, @Param("orderId") orderId: string) {
    return this.orders.cancel(request.auth!, orderId, request.requestId);
  }
}
