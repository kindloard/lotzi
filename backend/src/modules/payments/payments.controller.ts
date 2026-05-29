import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/auth.types";
import { AccessTokenGuard } from "../auth/guards/access-token.guard";
import { CsrfGuard } from "../auth/guards/csrf.guard";
import { PERMISSIONS } from "../rbac/permissions";
import { RbacGuard } from "../rbac/rbac.guard";
import { RequirePermissions } from "../rbac/require-permissions.decorator";
import { CreateRefundDto, RetryPaymentDto, VerifyPaymentDto } from "./dto/payments.dto";
import { PaymentsService } from "./payments.service";

@Controller("v1/payments")
@UseGuards(AccessTokenGuard, RbacGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(":paymentId/status")
  @RequirePermissions(PERMISSIONS.ORDER_READ_OWN)
  status(@Req() request: AuthenticatedRequest, @Param("paymentId") paymentId: string) {
    return this.payments.status(request.auth!, paymentId);
  }

  @Post(":paymentId/retry")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.ORDER_CREATE)
  retry(
    @Req() request: AuthenticatedRequest,
    @Param("paymentId") paymentId: string,
    @Body() dto: RetryPaymentDto
  ) {
    return this.payments.retry(request.auth!, paymentId, dto, request.requestId);
  }

  @Post(":paymentId/verify")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.ORDER_READ_OWN)
  verify(
    @Req() request: AuthenticatedRequest,
    @Param("paymentId") paymentId: string,
    @Body() _dto: VerifyPaymentDto
  ) {
    return this.payments.verifyUserReturn(request.auth!, paymentId, request.requestId);
  }

  @Post(":paymentId/refunds")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.ORDER_READ_OWN)
  refund(
    @Req() request: AuthenticatedRequest,
    @Param("paymentId") paymentId: string,
    @Body() dto: CreateRefundDto
  ) {
    return this.payments.refund(request.auth!, paymentId, dto, request.requestId);
  }
}
