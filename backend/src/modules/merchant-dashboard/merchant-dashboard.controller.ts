import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/auth.types";
import { AccessTokenGuard } from "../auth/guards/access-token.guard";
import { MerchantDashboardService } from "./merchant-dashboard.service";

@Controller("merchant/dashboard")
@UseGuards(AccessTokenGuard)
export class MerchantDashboardController {
  constructor(private readonly dashboard: MerchantDashboardService) {}

  @Get("bootstrap")
  bootstrap(@Req() request: AuthenticatedRequest) {
    return this.dashboard.bootstrap(request.auth!);
  }
}
