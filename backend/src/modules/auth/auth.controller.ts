import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import { Response } from "express";
import { DeviceFingerprintService } from "../../security/device-fingerprint.service";
import { TokenService } from "../../security/token.service";
import { RbacGuard } from "../rbac/rbac.guard";
import { AuthService } from "./auth.service";
import {
  GoogleLinkDto,
  GoogleLoginDto,
  LoginDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  RejectedRedirectDto,
  ResendOtpDto,
  SignupDto,
  VerifySignupOtpDto
} from "./dto/auth.dto";
import { AccessTokenGuard } from "./guards/access-token.guard";
import { CsrfGuard } from "./guards/csrf.guard";
import { AuthenticatedRequest, RequestContext } from "./auth.types";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly devices: DeviceFingerprintService,
    private readonly tokens: TokenService
  ) {}

  @Post("signup")
  signup(
    @Body() dto: SignupDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.auth.signup(dto, this.context(request), response);
  }

  @Post("signup/verify")
  verifySignup(
    @Body() dto: VerifySignupOtpDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.auth.verifySignupOtp(dto, this.context(request), response);
  }

  @Post("otp/resend")
  resendOtp(
    @Body() dto: ResendOtpDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.auth.resendSignupOtp(dto, this.context(request), response);
  }

  @Post("login")
  login(
    @Body() dto: LoginDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.auth.login(dto, this.context(request), response);
  }

  @Post("google")
  google(
    @Body() dto: GoogleLoginDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.auth.googleLogin(dto, this.context(request), response);
  }

  @Post("google/link")
  googleLink(
    @Body() dto: GoogleLinkDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.auth.linkGoogle(dto, this.context(request), response);
  }

  @Post("password-reset/request")
  requestPasswordReset(
    @Body() dto: PasswordResetRequestDto,
    @Req() request: AuthenticatedRequest
  ) {
    return this.auth.requestPasswordReset(dto, this.context(request));
  }

  @Post("password-reset/confirm")
  confirmPasswordReset(
    @Body() dto: PasswordResetConfirmDto,
    @Req() request: AuthenticatedRequest
  ) {
    return this.auth.confirmPasswordReset(dto, this.context(request));
  }

  @Post("redirect/rejected")
  rejectedRedirect(
    @Body() dto: RejectedRedirectDto,
    @Req() request: AuthenticatedRequest
  ) {
    return this.auth.recordRejectedRedirect(dto, this.context(request));
  }

  @Post("refresh")
  refresh(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.auth.refresh(
      this.refreshToken(request),
      this.clientSecret(request),
      this.context(request),
      response
    );
  }

  @Post("logout")
  logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.auth.logout(this.refreshToken(request), response);
  }

  @Get("session")
  @UseGuards(AccessTokenGuard)
  session(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    return this.auth.session(request.auth!, response);
  }

  @Get("sessions")
  @UseGuards(AccessTokenGuard, RbacGuard)
  sessions(@Req() request: AuthenticatedRequest) {
    return this.auth.listSessions(request.auth!.userId);
  }

  @Delete("sessions/:id")
  @UseGuards(AccessTokenGuard, CsrfGuard, RbacGuard)
  revokeSession(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.auth.revokeSession(request.auth!.userId, id);
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

  private refreshToken(request: AuthenticatedRequest): string | undefined {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    return cookies?.[this.tokens.refreshCookieName()];
  }

  private clientSecret(request: AuthenticatedRequest): string | undefined {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    return cookies?.[this.tokens.clientCookieName()];
  }
}
