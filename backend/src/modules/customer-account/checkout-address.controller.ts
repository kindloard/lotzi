import { Controller, Get, Query, Req, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { requestTimer } from "../../common/request-timing";
import { AuthenticatedRequest } from "../auth/auth.types";
import { JwtHintGuard } from "../auth/guards/jwt-hint.guard";
import { CustomerAccountService } from "./customer-account.service";

@Controller("v1/me")
@UseGuards(JwtHintGuard)
export class CheckoutAddressController {
  constructor(private readonly account: CustomerAccountService) {}

  @Get("checkout-address")
  async checkoutAddress(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
    @Query("selectedAddressId") selectedAddressId?: string
  ) {
    const timer = requestTimer(request);
    const result = await timer.time("address", () => this.account.checkoutAddress(request.auth!, selectedAddressId));
    timer.finishTotal();
    response.setHeader("Server-Timing", timer.serverTiming());
    return result;
  }
}
