import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { memoryStorage } from "multer";
import { DeviceFingerprintService } from "../../security/device-fingerprint.service";
import { AuthenticatedRequest, RequestContext } from "../auth/auth.types";
import { AccessTokenGuard } from "../auth/guards/access-token.guard";
import { CsrfGuard } from "../auth/guards/csrf.guard";
import { PERMISSIONS } from "../rbac/permissions";
import { RbacGuard } from "../rbac/rbac.guard";
import { RequirePermissions } from "../rbac/require-permissions.decorator";
import { CustomerAccountService } from "./customer-account.service";
import {
  ChangePasswordDto,
  ConfirmEmailChangeDto,
  CreateAddressDto,
  DeleteAccountDto,
  RequestEmailChangeDto,
  UpdateAddressDto,
  UpdateProfileDto
} from "./dto/customer-account.dto";

@Controller("v1/me")
@UseGuards(AccessTokenGuard, RbacGuard)
export class CustomerAccountController {
  constructor(
    private readonly account: CustomerAccountService,
    private readonly devices: DeviceFingerprintService
  ) {}

  @Get("bootstrap")
  @RequirePermissions(PERMISSIONS.PROFILE_READ)
  bootstrap(@Req() request: AuthenticatedRequest) {
    return this.account.bootstrap(request.auth!);
  }

  @Get("profile")
  @RequirePermissions(PERMISSIONS.PROFILE_READ)
  profile(@Req() request: AuthenticatedRequest) {
    return this.account.profile(request.auth!);
  }

  @Patch("profile")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.PROFILE_WRITE)
  updateProfile(@Req() request: AuthenticatedRequest, @Body() dto: UpdateProfileDto) {
    return this.account.updateProfile(request.auth!, dto, this.context(request));
  }

  @Post("avatar")
  @UseGuards(CsrfGuard)
  @UseInterceptors(FileInterceptor("file", {
    storage: memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 }
  }))
  @RequirePermissions(PERMISSIONS.PROFILE_WRITE)
  uploadAvatar(
    @Req() request: AuthenticatedRequest,
    @Body() _body: Record<string, unknown>,
    @UploadedFile() file?: Express.Multer.File
  ) {
    return this.account.uploadAvatar(request.auth!, file, this.context(request));
  }

  @Get("addresses")
  @RequirePermissions(PERMISSIONS.PROFILE_READ)
  addresses(@Req() request: AuthenticatedRequest) {
    return this.account.addresses(request.auth!);
  }

  @Post("addresses")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.PROFILE_WRITE)
  createAddress(@Req() request: AuthenticatedRequest, @Body() dto: CreateAddressDto) {
    return this.account.createAddress(request.auth!, dto, this.context(request));
  }

  @Patch("addresses/:id")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.PROFILE_WRITE)
  updateAddress(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: UpdateAddressDto
  ) {
    return this.account.updateAddress(request.auth!, id, dto, this.context(request));
  }

  @Delete("addresses/:id")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.PROFILE_WRITE)
  deleteAddress(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.account.deleteAddress(request.auth!, id, this.context(request));
  }

  @Post("addresses/:id/default")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.PROFILE_WRITE)
  setDefaultAddress(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.account.setDefaultAddress(request.auth!, id, this.context(request));
  }

  @Get("orders")
  @RequirePermissions(PERMISSIONS.ORDER_READ_OWN)
  orders(
    @Req() request: AuthenticatedRequest,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string
  ) {
    return this.account.orders(request.auth!, cursor, limit ? Number(limit) : undefined);
  }

  @Get("sessions")
  @RequirePermissions(PERMISSIONS.PROFILE_READ)
  sessions(@Req() request: AuthenticatedRequest) {
    return this.account.sessions(request.auth!);
  }

  @Delete("sessions/:id")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.PROFILE_WRITE)
  revokeSession(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.account.revokeSession(request.auth!, id, this.context(request), response);
  }

  @Delete("sessions")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.PROFILE_WRITE)
  revokeOtherSessions(@Req() request: AuthenticatedRequest) {
    return this.account.revokeOtherSessions(request.auth!, this.context(request));
  }

  @Patch("security/password")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.PROFILE_WRITE)
  changePassword(@Req() request: AuthenticatedRequest, @Body() dto: ChangePasswordDto) {
    return this.account.changePassword(request.auth!, dto, this.context(request));
  }

  @Post("email-change/request")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.PROFILE_WRITE)
  requestEmailChange(@Req() request: AuthenticatedRequest, @Body() dto: RequestEmailChangeDto) {
    return this.account.requestEmailChange(request.auth!, dto, this.context(request));
  }

  @Post("email-change/confirm")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.PROFILE_WRITE)
  confirmEmailChange(@Req() request: AuthenticatedRequest, @Body() dto: ConfirmEmailChangeDto) {
    return this.account.confirmEmailChange(request.auth!, dto, this.context(request));
  }

  @Get("activity")
  @RequirePermissions(PERMISSIONS.PROFILE_READ)
  activity(@Req() request: AuthenticatedRequest, @Query("limit") limit?: string) {
    return this.account.activity(request.auth!, limit ? Number(limit) : undefined);
  }

  @Post("delete-request")
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.PROFILE_WRITE)
  requestDeleteAccount(@Req() request: AuthenticatedRequest) {
    return this.account.requestDeleteAccount(request.auth!, this.context(request));
  }

  @Delete()
  @UseGuards(CsrfGuard)
  @RequirePermissions(PERMISSIONS.PROFILE_WRITE)
  deleteAccount(
    @Req() request: AuthenticatedRequest,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.account.deleteAccount(request.auth!, dto, this.context(request), response);
  }

  private context(request: AuthenticatedRequest): RequestContext {
    const device = this.devices.fromRequest(request);
    return {
      requestId: request.requestId,
      ip: device.ipAddress,
      userAgent: device.userAgent,
      deviceFingerprint: device.fingerprint,
      deviceMetadata: device.metadata
    };
  }
}
