import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { PosRegisterService } from './pos-register.service';
import { AccessTokenGuard } from '@/modules/auth/guards/access-token.guard';

@Controller('v1/stores/:storeId/pos/registers')
@UseGuards(AccessTokenGuard)
export class PosRegisterController {
  constructor(private readonly posRegisterService: PosRegisterService) {}

  @Post()
  create(@Param('storeId') storeId: string, @Body('name') name: string) {
    return this.posRegisterService.createRegister(storeId, name);
  }

  @Get()
  findAll(@Param('storeId') storeId: string) {
    return this.posRegisterService.getRegisters(storeId);
  }

  @Get(':id')
  findOne(@Param('storeId') storeId: string, @Param('id') id: string) {
    return this.posRegisterService.getRegisterById(id, storeId);
  }
}
