import { Controller, Get, Post, Body, Param, UseGuards, Patch } from '@nestjs/common';
import { PosSessionService } from './pos-session.service';
import { AccessTokenGuard } from '@/modules/auth/guards/access-token.guard';

@Controller('v1/stores/:storeId/pos/sessions')
@UseGuards(AccessTokenGuard)
export class PosSessionController {
  constructor(private readonly posSessionService: PosSessionService) {}

  @Post('open')
  openSession(
    @Body('registerId') registerId: string,
    @Body('openingFloat') openingFloat: number,
  ) {
    return this.posSessionService.openSession(registerId, openingFloat);
  }

  @Patch(':id/close')
  closeSession(
    @Param('id') id: string,
    @Body('actualCash') actualCash: number,
  ) {
    return this.posSessionService.closeSession(id, actualCash);
  }

  @Get(':id')
  getSession(@Param('id') id: string) {
    return this.posSessionService.getSessionStatus(id);
  }
}
