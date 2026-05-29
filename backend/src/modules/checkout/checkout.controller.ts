import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/auth.types";
import { AccessTokenGuard } from "../auth/guards/access-token.guard";
import { CsrfGuard } from "../auth/guards/csrf.guard";
import { PERMISSIONS } from "../rbac/permissions";
import { RbacGuard } from "../rbac/rbac.guard";
import { RequirePermissions } from "../rbac/require-permissions.decorator";
import { CheckoutService } from "./checkout.service";
import { CreateCheckoutSessionDto } from "./dto/checkout.dto";

@Controller("v1/checkout")
@UseGuards(AccessTokenGuard, RbacGuard)
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post("session")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.ORDER_CREATE)
  createSession(@Req() request: AuthenticatedRequest, @Body() dto: CreateCheckoutSessionDto) {
    return this.checkout.createSession(request.auth!, dto, request.requestId);
  }
}
