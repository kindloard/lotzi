import { Controller, Post, Body, Param, UseGuards } from '@nestjs/common';
import { PosCheckoutService } from './pos-checkout.service';
import { AccessTokenGuard } from '@/modules/auth/guards/access-token.guard';

@Controller('v1/stores/:storeId/pos/checkout')
@UseGuards(AccessTokenGuard)
export class PosCheckoutController {
  constructor(private readonly posCheckoutService: PosCheckoutService) {}

  @Post()
  processCheckout(
    @Param('storeId') storeId: string,
    @Body() payload: any, // In production, we'd use a DTO here
  ) {
    return this.posCheckoutService.processCheckout({
      ...payload,
      storeId,
    });
  }
}
