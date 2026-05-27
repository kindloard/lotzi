import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import { Request, Response } from "express";
import { AdminApprovalsService } from "./admin-approvals.service";
import { AdminAuthGuard } from "./admin-auth.guard";
import { AdminAuthService } from "./admin-auth.service";
import {
  AdminApprovalDecisionDto,
  AdminLoginDto,
  AdminRejectionDto
} from "./dto/admin-approval.dto";

@Controller("admin/merchant-approvals")
export class AdminController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly approvals: AdminApprovalsService
  ) {}

  @Post("login")
  @HttpCode(200)
  login(
    @Body() dto: AdminLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.auth.login(dto.password, request, response);
  }

  @Post("logout")
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  logout(@Res({ passthrough: true }) response: Response) {
    return this.auth.logout(response);
  }

  @Get("session")
  @UseGuards(AdminAuthGuard)
  session(@Req() request: Request) {
    return this.auth.session(request);
  }

  @Get()
  @UseGuards(AdminAuthGuard)
  listPending() {
    return this.approvals.listPending();
  }

  @Post(":storeId/approve")
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  approve(@Param("storeId") storeId: string, @Body() dto: AdminApprovalDecisionDto) {
    return this.approvals.approve(storeId, dto);
  }

  @Post(":storeId/reject")
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  reject(@Param("storeId") storeId: string, @Body() dto: AdminRejectionDto) {
    return this.approvals.reject(storeId, dto);
  }
}
