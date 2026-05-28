import { Body, Controller, Get, Patch, Req, UseGuards } from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/auth.types";
import { AccessTokenGuard } from "../auth/guards/access-token.guard";
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

  @Patch("settings/location")
  updateStoreLocation(
    @Req() request: AuthenticatedRequest,
    @Body() dto: UpdateStoreLocationDto
  ) {
    return this.dashboard.updateStoreLocation(request.auth!, dto);
  }
}
