import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { AuthenticatedRequest } from "../auth/auth.types";
import { AccessTokenGuard } from "../auth/guards/access-token.guard";
import { CsrfGuard } from "../auth/guards/csrf.guard";
import { UpdateCodSettingsDto, UpdatePhonepeSettingsDto } from "./dto/payment-settings.dto";
import { PaymentSettingsService } from "./payment-settings.service";

@Controller("v1/stores/:storeId/payment-settings")
@UseGuards(AccessTokenGuard)
export class PaymentSettingsController {
  constructor(private readonly settings: PaymentSettingsService) {}

  @Get()
  getSettings(@Req() request: AuthenticatedRequest, @Param("storeId") storeId: string) {
    return this.settings.getSettings(request.auth!, storeId);
  }

  @Put("phonepe")
  @UseGuards(CsrfGuard)
  updatePhonepe(
    @Req() request: AuthenticatedRequest,
    @Param("storeId") storeId: string,
    @Body() dto: UpdatePhonepeSettingsDto
  ) {
    return this.settings.updatePhonepeSettings(request.auth!, storeId, dto, {
      requestId: request.requestId,
      ipAddress: request.ip
    });
  }

  @Post("phonepe/test")
  @UseGuards(CsrfGuard)
  testPhonepe(@Req() request: AuthenticatedRequest, @Param("storeId") storeId: string) {
    return this.settings.testPhonepeConnection(request.auth!, storeId, {
      requestId: request.requestId,
      ipAddress: request.ip
    });
  }

  @Put("cod")
  @UseGuards(CsrfGuard)
  updateCod(
    @Req() request: AuthenticatedRequest,
    @Param("storeId") storeId: string,
    @Body() dto: UpdateCodSettingsDto
  ) {
    return this.settings.updateCodSettings(request.auth!, storeId, dto, {
      requestId: request.requestId,
      ipAddress: request.ip
    });
  }
}
