import { Body, Controller, Get, Param, Patch, Req, UseGuards } from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/auth.types";
import { AccessTokenGuard } from "../auth/guards/access-token.guard";
import { CsrfGuard } from "../auth/guards/csrf.guard";
import { MerchantOrderStatusUpdateDto } from "./dto/merchant-orders.dto";
import { UpdateStoreLocationDto } from "./dto/merchant-settings.dto";
import { MerchantDashboardService } from "./merchant-dashboard.service";

@Controller("merchant/dashboard")
@UseGuards(AccessTokenGuard)
export class MerchantDashboardController {
  constructor(private readonly dashboard: MerchantDashboardService) {}

  @Get("bootstrap")
  bootstrap(@Req() request: AuthenticatedRequest) {
    return this.dashboard.bootstrap(request.auth!);
  }

  @Get("settings/location")
  storeLocation(@Req() request: AuthenticatedRequest) {
    return this.dashboard.getStoreLocation(request.auth!);
  }

  @Get("orders")
  orders(@Req() request: AuthenticatedRequest) {
    return this.dashboard.orders(request.auth!);
  }

  @Get("orders/:orderId")
  order(
    @Req() request: AuthenticatedRequest,
    @Param("orderId") orderId: string
  ) {
    return this.dashboard.order(request.auth!, orderId);
  }

  @Patch("orders/status")
  @UseGuards(CsrfGuard)
  updateOrderStatus(
    @Req() request: AuthenticatedRequest,
    @Body() dto: MerchantOrderStatusUpdateDto
  ) {
    return this.dashboard.updateOrderStatus(request.auth!, dto, request.requestId);
  }

  @Patch("settings/location")
  updateStoreLocation(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateStoreLocationDto
  ) {
    return this.dashboard.updateStoreLocation(request.auth!, dto);
  }
}
