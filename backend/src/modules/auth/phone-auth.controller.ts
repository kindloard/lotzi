import { Body, Controller, Get, Headers, Post, Query, Req, Res } from "@nestjs/common";
import { Response } from "express";
import { DeviceFingerprintService } from "../../security/device-fingerprint.service";
import { AuthenticatedRequest, RequestContext } from "./auth.types";
import { AuthService } from "./auth.service";
import {
  CheckoutOnboardingStartDto,
  PhoneSignupDto,
  SendPhoneOtpDto,
  VerifyPhoneOtpDto
} from "./dto/auth.dto";

@Controller("v1/auth")
export class PhoneAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly devices: DeviceFingerprintService
  ) {}

  @Post("checkout-onboarding/start")
  startCheckoutOnboarding(
    @Body() dto: CheckoutOnboardingStartDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    this.disableResponseCaching(response);
    return this.auth.startCheckoutOnboarding(dto, this.context(request), idempotencyKey);
  }

  @Get("checkout-onboarding/status")
  checkoutOnboardingStatus(
    @Query("flow") flowToken: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    this.disableResponseCaching(response);
    return this.auth.checkoutOnboardingStatus(
      flowToken,
      this.context(request),
      this.proofCookie(request)
    );
  }

  @Post("otp/send")
  sendPhoneOtp(
    @Body() dto: SendPhoneOtpDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    this.disableResponseCaching(response);
    return this.auth.sendPhoneOtp(dto, this.context(request), idempotencyKey);
  }

  @Post("otp/verify")
  verifyPhoneOtp(
    @Body() dto: VerifyPhoneOtpDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    this.disableResponseCaching(response);
    return this.auth.verifyPhoneOtp(dto, this.context(request), response);
  }

  @Post("phone/signup")
  phoneSignup(
    @Body() dto: PhoneSignupDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    this.disableResponseCaching(response);
    return this.auth.phoneSignup(dto, this.context(request), this.proofCookie(request), response);
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

  private proofCookie(request: AuthenticatedRequest): string | undefined {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    return cookies?.[this.auth.checkoutPhoneProofCookieName()];
  }

  private disableResponseCaching(response: Response): void {
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Expires", "0");
    response.removeHeader("ETag");
  }
}
