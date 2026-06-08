import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AuditOutcome,
  CheckoutOnboardingFlowStatus,
  IdentityProviderName,
  OtpPurpose,
  OtpProviderName,
  PhoneOtpStatus,
  Prisma,
  SessionRevokedReason,
  User,
  UserProviderType,
  UserStatus
} from "@prisma/client";
import { Response } from "express";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { FirebaseAdminService } from "../../integrations/firebase/firebase-admin.service";
import { CryptoService } from "../../security/crypto.service";
import { OtpService } from "../../security/otp.service";
import { PasswordService } from "../../security/password.service";
import { PhoneNumberService } from "../../security/phone-number.service";
import { TokenService } from "../../security/token.service";
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_MINUTES,
  RESET_SELECTOR_BYTES,
  RESET_VERIFIER_BYTES
} from "../../security/security.constants";
import { AuditService } from "../audit/audit.service";
import { MailService } from "../mail/mail.service";
import { RateLimitService } from "../rate-limit/rate-limit.service";
import { AuthStateInvalidator } from "../rbac/auth-state-invalidator.service";
import { RbacEngine } from "../rbac/rbac.engine";
import { ROLE_CODES } from "../rbac/permissions";
import { ObservabilityService } from "../observability/observability.service";
import { StoreCreationService } from "../stores/store-creation.service";
import { CustomerCreationService } from "../users/services/customer-creation.service";
import { MerchantCreationService } from "../users/services/merchant-creation.service";
import { UserCreationService } from "../users/services/user-creation.service";
import { IdentityProviderRepository } from "../users/repositories/identity-provider.repository";
import { UserRepository } from "../users/repositories/user.repository";
import { AuthPerformanceService, AuthRequestTimer } from "./auth-performance.service";
import { AuthStateRepository } from "./auth-state.repository";
import { AuthRepository } from "./auth.repository";
import {
  AUTH_REFRESH_INVALID,
  AUTH_REFRESH_MISSING,
  authRefreshRace,
  authUnauthorized
} from "./auth-errors";
import { AuthenticatedPrincipal, AuthRouteState, RequestContext } from "./auth.types";
import {
  GoogleLinkDto,
  GoogleLoginDto,
  CheckoutOnboardingStartDto,
  LoginDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  PhoneSignupDto,
  RejectedRedirectDto,
  ResendOtpDto,
  SendPhoneOtpDto,
  SignupDto,
  VerifyPhoneOtpDto,
  VerifySignupOtpDto
} from "./dto/auth.dto";
import { Fast2SmsOtpProvider } from "./fast2sms-otp.provider";
import { OtpProviderError } from "./phone-otp.provider";
import { SessionRepository } from "./repositories/session.repository";
import { SessionCacheService } from "./session-cache.service";
import { SessionService } from "./session.service";

type SignupAccountType = "CUSTOMER" | "MERCHANT";

interface SignupIntent {
  accountType: SignupAccountType;
  storeName?: string;
}

interface CheckoutAddressPayload {
  email?: string;
  label?: string;
  recipientName?: string;
  recipientPhone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  latitude?: number;
  longitude?: number;
  deliveryInstructions?: string;
  isDefault?: boolean;
}

type LoginIdentifier =
  | { kind: "email"; value: string }
  | { kind: "phone"; value: string };

type LockedCheckoutFlowRow = {
  id: string;
  phone_number: string;
  phone_proof_hash: string | null;
  phone_verified_at: Date | null;
  address_ciphertext: string;
  address_nonce: string;
  next_path: string;
  status: CheckoutOnboardingFlowStatus;
  device_fingerprint_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
};

type LockedPhoneOtpRow = {
  id: string;
  otp_hash: string;
  otp_nonce: string;
  attempt_count: number;
  blocked_until: Date | null;
  expires_at: Date;
};

const AUTH_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 30_000
} as const;

export interface PublicUser {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  status: User["status"];
  emailVerified: boolean;
  authzVersion: number;
  roleCodes: string[];
}

export interface SessionPayload {
  user: PublicUser;
  accessTokenExpiresAt: string;
  routeState: Omit<AuthRouteState, "user" | "roleCodes">;
  redirectTo: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repository: AuthRepository,
    private readonly authState: AuthStateRepository,
    private readonly users: UserRepository,
    private readonly userCreation: UserCreationService,
    private readonly customerCreation: CustomerCreationService,
    private readonly merchantCreation: MerchantCreationService,
    private readonly storeCreation: StoreCreationService,
    private readonly identityProviders: IdentityProviderRepository,
    private readonly sessions: SessionRepository,
    private readonly sessionService: SessionService,
    private readonly password: PasswordService,
    private readonly otp: OtpService,
    private readonly phones: PhoneNumberService,
    private readonly crypto: CryptoService,
    private readonly tokens: TokenService,
    private readonly rateLimit: RateLimitService,
    private readonly fast2Sms: Fast2SmsOtpProvider,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly firebaseAdmin: FirebaseAdminService,
    private readonly authStateInvalidator: AuthStateInvalidator,
    private readonly rbac: RbacEngine,
    private readonly performance: AuthPerformanceService,
    private readonly config: ConfigService,
    private readonly sessionCache: SessionCacheService,
    private readonly observability: ObservabilityService
  ) {}

  checkoutPhoneProofCookieName(): string {
    return this.config.get<string>("NODE_ENV") === "production" && !this.config.get<string>("COOKIE_DOMAIN")
      ? "__Host-nama_checkout_phone_proof"
      : "nama_checkout_phone_proof";
  }

  async signup(dto: SignupDto, context: RequestContext, response?: Response) {
    const timer = this.performance.start("signup", response);
    const email = this.normalizeEmail(dto.email);
    try {
      await timer.time("rate_limit", () => this.enforceSignupLimits(email, context));

      const intent = this.signupIntentFromDto(dto);
      const [passwordHash, existing] = await Promise.all([
        timer.time("password_hash", () => this.password.hash(dto.password)),
        timer.time("user_lookup", () => this.users.findByEmail(email))
      ]);
      const userIdForHash = existing?.id ?? randomUUID();
      const code = this.otp.generate();
      const nonce = this.otp.nonce();
      const otpHash = this.otp.hash(code, userIdForHash, email, nonce, OtpPurpose.EMAIL_SIGNUP);

      const result = await timer.time("signup_transaction", () =>
        this.repository.prisma.$transaction(
          async (tx) => {
            const userResult = await this.userCreation.createOrUpdatePendingEmailUser(
              {
                id: userIdForHash,
                email,
                fullName: this.sanitizeName(dto.name),
                passwordHash
              },
              tx
            );

            if (userResult.blockedByExistingActiveUser) {
              throw new ConflictException({
                code: "EMAIL_ALREADY_REGISTERED",
                message: "This email already has an account. Log in to continue."
              });
            }

            const createdOtp = await this.repository.createSignupOtp(
              {
                userId: userResult.user.id,
                email,
                otpHash,
                otpNonce: nonce,
                expiresAt: this.minutesFromNow(OTP_TTL_MINUTES),
                cooldownUntil: this.secondsFromNow(OTP_RESEND_COOLDOWN_SECONDS),
                metadata: intent as unknown as Prisma.InputJsonObject
              },
              tx
            );
            return { user: userResult.user, ...createdOtp };
          },
          AUTH_TRANSACTION_OPTIONS
        )
      );

      if (result.sent) {
        await timer.time("email_enqueue", () =>
          this.mail.sendSignupOtp(email, code, `signup-otp:${result.otpId}`)
        );
      }

      this.audit.record({
        eventType: "auth.signup.requested",
        actor: email,
        actorUserId: result.user.id,
        outcome: AuditOutcome.PENDING,
        ip: context.ip,
        requestId: context.requestId,
        metadata: {
          sent: result.sent,
          accountType: intent.accountType,
          cooldownUntil: result.cooldownUntil?.toISOString()
        }
      });

      return {
        status: "OTP_REQUIRED",
        email,
        cooldownUntil: result.cooldownUntil?.toISOString()
      };
    } finally {
      timer.end({ email });
    }
  }

  async verifySignupOtp(dto: VerifySignupOtpDto, context: RequestContext, response: Response) {
    const timer = this.performance.start("otp_verify", response);
    const email = this.normalizeEmail(dto.email);
    let actorUserId: string | undefined;
    try {
      await timer.time("rate_limit", () =>
        Promise.all([
          this.rateLimit.enforce(`otp:verify:email:${email}`, OTP_MAX_ATTEMPTS, 15 * 60),
          this.rateLimit.enforce(`otp:verify:ip:${context.ip ?? "unknown"}`, 50, 15 * 60)
        ]).then(() => undefined)
      );

      const latest = await timer.time("otp_lookup", () =>
        this.repository.findLatestSignupOtp(email)
      );
      if (!latest) {
        await timer.time("constant_invalid_work", () => this.password.verify(dto.otp, null));
        throw new UnauthorizedException("Invalid or expired verification code.");
      }

      actorUserId = latest.userId;
      const otpHash = this.otp.hash(
        dto.otp,
        latest.userId,
        email,
        latest.otpNonce,
        OtpPurpose.EMAIL_SIGNUP
      );
      const intent = this.signupIntentFromMetadata(latest.metadata);

      const result = await timer.time("otp_transaction", () =>
        this.repository.prisma.$transaction(
          async (tx) => {
            const verified = await this.repository.verifySignupOtp(latest.userId, email, otpHash, tx);
            if (!verified.ok) {
              return { ...verified, user: null as User | null };
            }

            const activated = await this.users.findById(latest.userId, tx);
            if (!activated) {
              return { ok: false, reason: "not_found", attempts: verified.attempts, user: null };
            }
            await this.completeSignupOnboarding(activated, intent, tx);
            const user = await this.users.findById(latest.userId, tx);
            return user
              ? { ...verified, user }
              : { ok: false, reason: "not_found", attempts: verified.attempts, user: null };
          },
          AUTH_TRANSACTION_OPTIONS
        )
      );

      if (!result.ok || !result.user) {
        this.audit.record({
          eventType: "auth.signup.otp_failed",
          actor: email,
          actorUserId: actorUserId,
          outcome: AuditOutcome.FAILURE,
          ip: context.ip,
          requestId: context.requestId,
          metadata: { reason: result.reason, attempts: result.attempts }
        });
        throw new UnauthorizedException("Invalid or expired verification code.");
      }

      const session = await this.createSession(
        result.user,
        context,
        response,
        timer,
        this.signupSessionRoleCodes(intent)
      );
      this.audit.record({
        eventType: "auth.signup.verified",
        actor: email,
        actorUserId: result.user.id,
        outcome: AuditOutcome.SUCCESS,
        ip: context.ip,
        requestId: context.requestId,
        sessionId: session.sessionId,
        metadata: { accountType: intent.accountType }
      });
      return session;
    } finally {
      timer.end({ email, actorUserId });
    }
  }

  async resendSignupOtp(dto: ResendOtpDto, context: RequestContext, response?: Response) {
    const timer = this.performance.start("otp_resend", response);
    const email = this.normalizeEmail(dto.email);
    try {
      await timer.time("rate_limit", () =>
        Promise.all([
          this.rateLimit.enforce(`otp:resend:email:${email}`, 5, 24 * 60 * 60),
          this.rateLimit.enforce(`otp:resend:ip:${context.ip ?? "unknown"}`, 20, 24 * 60 * 60)
        ]).then(() => undefined)
      );

      const user = await timer.time("user_lookup", () => this.users.findByEmail(email));
      if (!user || user.status !== UserStatus.PENDING) {
        return { status: "OTP_REQUIRED", email };
      }

      const latest = await timer.time("otp_lookup", () => this.repository.findLatestSignupOtp(email));
      const code = this.otp.generate();
      const nonce = this.otp.nonce();
      const result = await timer.time("otp_create", () =>
        this.repository.createSignupOtp({
          userId: user.id,
          email,
          otpHash: this.otp.hash(code, user.id, email, nonce, OtpPurpose.EMAIL_SIGNUP),
          otpNonce: nonce,
          expiresAt: this.minutesFromNow(OTP_TTL_MINUTES),
          cooldownUntil: this.secondsFromNow(OTP_RESEND_COOLDOWN_SECONDS),
          metadata: latest?.metadata ?? { accountType: "CUSTOMER" }
        })
      );

      if (result.sent) {
        await timer.time("email_enqueue", () =>
          this.mail.sendSignupOtp(email, code, `signup-otp:${result.otpId}`)
        );
      }

      return {
        status: "OTP_REQUIRED",
        email,
        cooldownUntil: result.cooldownUntil?.toISOString()
      };
    } finally {
      timer.end({ email });
    }
  }

  async startCheckoutOnboarding(
    dto: CheckoutOnboardingStartDto,
    context: RequestContext,
    idempotencyKey?: string
  ) {
    this.assertPhoneCheckoutEnabled();
    const phoneNumber = this.phones.normalizeIndianMobile(dto.recipientPhone);
    const email = this.normalizeEmail(dto.email);
    await this.enforceCheckoutOnboardingStartLimits(phoneNumber, context);

    const [existingPhoneUser, existingEmailUser] = await Promise.all([
      this.users.findByPhone(phoneNumber),
      this.users.findByEmail(email)
    ]);
    if (existingPhoneUser && existingPhoneUser.status !== UserStatus.DELETED) {
      this.audit.record({
        eventType: "auth.phone_recycle_or_duplicate_detected",
        actorUserId: existingPhoneUser.id,
        outcome: AuditOutcome.FAILURE,
        ip: context.ip,
        requestId: context.requestId,
        metadata: { phoneHash: this.phoneAuditHash(phoneNumber), stage: "start" }
      });
      throw new ConflictException({
        code: "PHONE_ALREADY_REGISTERED",
        message: "This phone number already has an account. Log in to continue checkout."
      });
    }
    if (existingEmailUser) {
      this.audit.record({
        eventType: "auth.email_duplicate_detected",
        actorUserId: existingEmailUser.id,
        outcome: AuditOutcome.FAILURE,
        ip: context.ip,
        requestId: context.requestId,
        metadata: { stage: "checkout_onboarding_start" }
      });
      throw new ConflictException({
        code: "EMAIL_ALREADY_REGISTERED",
        message: "This email already has an account. Log in to continue checkout."
      });
    }

    const normalizedAddress = this.checkoutAddressPayload(dto, phoneNumber);
    const flowToken = idempotencyKey
      ? this.checkoutDeterministicToken(idempotencyKey, phoneNumber, context)
      : this.crypto.randomBase64Url(32);
    const flowTokenHash = this.checkoutHash(flowToken);
    const idempotencyKeyHash = idempotencyKey
      ? this.checkoutHash(["checkout-start", context.deviceFingerprint, idempotencyKey].join(":"))
      : undefined;
    const existingFlow = idempotencyKeyHash
      ? await this.repository.prisma.checkoutOnboardingFlow.findUnique({
          where: { idempotencyKeyHash }
        })
      : null;

    if (existingFlow && existingFlow.expiresAt > new Date()) {
      return this.checkoutOnboardingStartResponse(flowToken, existingFlow.phoneNumber, existingFlow.expiresAt);
    }

    const encrypted = this.encryptCheckoutPayload(normalizedAddress);
    const expiresAt = this.secondsFromNow(this.config.get<number>("CHECKOUT_ONBOARDING_FLOW_TTL_SECONDS", 900));
    const flow = await this.repository.prisma.checkoutOnboardingFlow.upsert({
      where: { flowTokenHash },
      update: {
        addressCiphertext: encrypted.ciphertext,
        addressNonce: encrypted.nonce,
        expiresAt,
        nextPath: this.safeCheckoutNextPath(dto.nextPath),
        phoneNumber,
        status: CheckoutOnboardingFlowStatus.ADDRESS_COLLECTED
      },
      create: {
        addressCiphertext: encrypted.ciphertext,
        addressNonce: encrypted.nonce,
        deviceFingerprintHash: this.checkoutHash(context.deviceFingerprint),
        expiresAt,
        flowTokenHash,
        idempotencyKeyHash,
        nextPath: this.safeCheckoutNextPath(dto.nextPath),
        phoneNumber
      }
    });

    return this.checkoutOnboardingStartResponse(flowToken, flow.phoneNumber, flow.expiresAt);
  }

  async checkoutOnboardingStatus(flowToken: string, context: RequestContext, proofCookie?: string) {
    if (!flowToken || flowToken.length < 32) {
      return { valid: false, status: "INVALID" as const };
    }
    const flow = await this.repository.prisma.checkoutOnboardingFlow.findUnique({
      where: { flowTokenHash: this.checkoutHash(flowToken) },
      select: {
        id: true,
        phoneNumber: true,
        status: true,
        nextPath: true,
        expiresAt: true,
        phoneProofHash: true,
        phoneVerifiedAt: true,
        consumedAt: true,
        deviceFingerprintHash: true
      }
    });
    if (!flow || flow.expiresAt <= new Date() || flow.consumedAt) {
      return { valid: false, status: "EXPIRED" as const };
    }
    if (flow.deviceFingerprintHash !== this.checkoutHash(context.deviceFingerprint)) {
      this.audit.record({
        eventType: "otp.proof_failed",
        outcome: AuditOutcome.FAILURE,
        ip: context.ip,
        requestId: context.requestId,
        metadata: { reason: "device_mismatch", flowId: flow.id }
      });
      return { valid: false, status: "BLOCKED" as const };
    }

    const phoneVerified = flow.status === CheckoutOnboardingFlowStatus.PHONE_VERIFIED;
    const proofAlive = phoneVerified && flow.phoneVerifiedAt
      ? flow.phoneVerifiedAt.getTime() +
          this.config.get<number>("CHECKOUT_PHONE_PROOF_TTL_SECONDS", 600) * 1000 >
        Date.now()
      : false;
    const proofValid = proofAlive && proofCookie && flow.phoneProofHash
      ? this.crypto.timingSafeEqual(
          this.checkoutProofHash(proofCookie, flow.id, flow.phoneNumber, context),
          flow.phoneProofHash
        )
      : false;

    return {
      valid: true,
      flowToken,
      phoneNumber: flow.phoneNumber,
      phoneMasked: this.phones.mask(flow.phoneNumber),
      status: flow.status,
      phoneVerified,
      proofValid,
      nextPath: flow.nextPath,
      expiresAt: flow.expiresAt.toISOString()
    };
  }

  async sendPhoneOtp(
    dto: SendPhoneOtpDto,
    context: RequestContext,
    idempotencyKey?: string
  ) {
    this.assertPhoneCheckoutEnabled();
    const phoneNumber = this.phones.normalizeIndianMobile(dto.phoneNumber);
    await this.enforcePhoneOtpSendLimits(phoneNumber, context);

    const flow = await this.requireMutableCheckoutFlow(dto.flowToken, phoneNumber, context);
    const now = new Date();
    const idempotencyKeyHash = idempotencyKey
      ? this.checkoutHash(["otp-send", flow.id, idempotencyKey].join(":"))
      : undefined;

    if (idempotencyKeyHash) {
      const existing = await this.repository.prisma.phoneOtpVerification.findFirst({
        where: { flowId: flow.id, idempotencyKey: idempotencyKeyHash },
        orderBy: { createdAt: "desc" }
      });
      if (existing) {
        this.observability.recordOtpIdempotentSend();
        if (existing.status !== PhoneOtpStatus.FAILED) {
          return this.phoneOtpResponse(
            existing.otpReferenceId,
            existing.expiresAt,
            existing.cooldownUntil,
            existing.providerMessageId,
            existing.providerRawStatus,
            this.devPhoneOtpForExisting(flow.id, phoneNumber, existing.otpReferenceId, existing.providerRawStatus)
          );
        }
        throw new ServiceUnavailableException({
          code: "PHONE_OTP_SEND_ALREADY_FAILED",
          message: "This OTP send attempt already failed. Use resend to request a new code."
        });
      }
    }

    const latest = await this.repository.prisma.phoneOtpVerification.findFirst({
      where: {
        flowId: flow.id,
        phoneNumber,
        status: { in: [PhoneOtpStatus.PENDING, PhoneOtpStatus.BLOCKED] }
      },
      orderBy: { createdAt: "desc" }
    });

    if (latest?.blockedUntil && latest.blockedUntil > now) {
      this.observability.recordOtpBlocked("send");
      throw this.tooManyOtpAttempts(latest.blockedUntil);
    }
    if (latest?.cooldownUntil && latest.cooldownUntil > now) {
      return this.phoneOtpResponse(
        latest.otpReferenceId,
        latest.expiresAt,
        latest.cooldownUntil,
        latest.providerMessageId,
        latest.providerRawStatus,
        this.devPhoneOtpForExisting(flow.id, phoneNumber, latest.otpReferenceId, latest.providerRawStatus)
      );
    }

    const expiresAt = this.secondsFromNow(this.config.get<number>("PHONE_OTP_TTL_SECONDS", 300));
    const cooldownUntil = this.secondsFromNow(this.config.get<number>("PHONE_OTP_RESEND_COOLDOWN_SECONDS", 30));
    const otpReferenceId = this.crypto.randomBase64Url(18);
    const isDevOtpTransport = this.shouldUseDevPhoneOtpTransport();
    const code = isDevOtpTransport
      ? this.devPhoneOtpCode(flow.id, phoneNumber, otpReferenceId)
      : this.otp.generate();
    const nonce = this.otp.nonce();
    let created;
    try {
      created = await this.repository.prisma.phoneOtpVerification.create({
        data: {
          cooldownUntil,
          expiresAt,
          flowId: flow.id,
          idempotencyKey: idempotencyKeyHash,
          otpHash: this.otp.hashPhone(code, phoneNumber, nonce),
          otpNonce: nonce,
          otpReferenceId,
          phoneNumber,
          provider: OtpProviderName.FAST2SMS
        }
      });
    } catch (error) {
      if (!idempotencyKeyHash || !this.isUniqueConstraintError(error)) {
        throw error;
      }
      const replay = await this.repository.prisma.phoneOtpVerification.findFirst({
        where: { flowId: flow.id, idempotencyKey: idempotencyKeyHash },
        orderBy: { createdAt: "desc" }
      });
      if (replay && replay.status !== PhoneOtpStatus.FAILED) {
        this.observability.recordOtpIdempotentSend();
        return this.phoneOtpResponse(
          replay.otpReferenceId,
          replay.expiresAt,
          replay.cooldownUntil,
          replay.providerMessageId,
          replay.providerRawStatus,
          this.devPhoneOtpForExisting(flow.id, phoneNumber, replay.otpReferenceId, replay.providerRawStatus)
        );
      }
      throw new ServiceUnavailableException({
        code: "PHONE_OTP_SEND_ALREADY_FAILED",
        message: "This OTP send attempt already failed. Use resend to request a new code."
      });
    }

    if (isDevOtpTransport) {
      await this.repository.prisma.$transaction([
        this.repository.prisma.phoneOtpVerification.update({
          where: { id: created.id },
          data: {
            providerMessageId: undefined,
            providerRawStatus: "DEV_OTP"
          }
        }),
        this.repository.prisma.checkoutOnboardingFlow.update({
          where: { id: flow.id },
          data: { status: CheckoutOnboardingFlowStatus.OTP_SENT }
        })
      ]);
      this.observability.recordOtpSent("DEV_TOAST", "accepted");
      this.audit.record({
        eventType: latest ? "otp.resent" : "otp.sent",
        outcome: AuditOutcome.SUCCESS,
        ip: context.ip,
        requestId: context.requestId,
        metadata: {
          flowId: flow.id,
          otpReferenceId,
          phoneHash: this.phoneAuditHash(phoneNumber),
          provider: "DEV_TOAST",
          providerStatus: "DEV_OTP"
        } as Prisma.InputJsonObject
      });
      this.logger.log(JSON.stringify({
        event: latest ? "otp.resent" : "otp.sent",
        flowId: flow.id,
        outcome: "accepted",
        phoneHash: this.phoneAuditHash(phoneNumber),
        provider: "DEV_TOAST",
        providerStatus: "DEV_OTP",
        otpReferenceId,
        requestId: context.requestId
      }));
      return this.phoneOtpResponse(
        otpReferenceId,
        expiresAt,
        cooldownUntil,
        undefined,
        "DEV_OTP",
        code
      );
    }

    try {
      const providerResult = await this.fast2Sms.sendOtp({
        mobile: this.phones.toFast2SmsMobile(phoneNumber),
        otp: code,
        otpExpiryMinutes: Math.max(1, Math.ceil(this.config.get<number>("PHONE_OTP_TTL_SECONDS", 300) / 60)),
        requestId: otpReferenceId
      });
      await this.repository.prisma.$transaction([
        this.repository.prisma.phoneOtpVerification.update({
          where: { id: created.id },
          data: {
            providerMessageId: providerResult.providerMessageId,
            providerRawStatus: providerResult.rawStatus
          }
        }),
        this.repository.prisma.checkoutOnboardingFlow.update({
          where: { id: flow.id },
          data: { status: CheckoutOnboardingFlowStatus.OTP_SENT }
        })
      ]);
      this.observability.recordOtpSent("FAST2SMS", "accepted");
      this.audit.record({
        eventType: latest ? "otp.resent" : "otp.sent",
        outcome: AuditOutcome.SUCCESS,
        ip: context.ip,
        requestId: context.requestId,
        metadata: {
          flowId: flow.id,
          otpReferenceId,
          phoneHash: this.phoneAuditHash(phoneNumber),
          provider: "FAST2SMS",
          providerMessageId: providerResult.providerMessageId,
          providerStatus: providerResult.rawStatus
        } as Prisma.InputJsonObject
      });
      this.logger.log(JSON.stringify({
        event: latest ? "otp.resent" : "otp.sent",
        flowId: flow.id,
        outcome: "accepted",
        phoneHash: this.phoneAuditHash(phoneNumber),
        provider: "FAST2SMS",
        providerMessageId: providerResult.providerMessageId,
        providerStatus: providerResult.rawStatus,
        otpReferenceId,
        requestId: context.requestId
      }));
      return this.phoneOtpResponse(
        otpReferenceId,
        expiresAt,
        cooldownUntil,
        providerResult.providerMessageId,
        providerResult.rawStatus
      );
    } catch (error) {
      await this.repository.prisma.phoneOtpVerification.update({
        where: { id: created.id },
        data: { status: PhoneOtpStatus.FAILED }
      }).catch(() => undefined);
      this.audit.record({
        eventType: "otp.provider_failed",
        outcome: AuditOutcome.FAILURE,
        ip: context.ip,
        requestId: context.requestId,
        metadata: {
          flowId: flow.id,
          otpReferenceId,
          phoneHash: this.phoneAuditHash(phoneNumber),
          reason: error instanceof OtpProviderError ? error.code : "OTP_PROVIDER_UNAVAILABLE"
        } as Prisma.InputJsonObject
      });
      this.observability.recordOtpProviderFailure(
        "FAST2SMS",
        error instanceof OtpProviderError ? error.code : "unavailable"
      );
      this.logger.warn(JSON.stringify({
        event: "otp.provider_failed",
        flowId: flow.id,
        outcome: "failure",
        phoneHash: this.phoneAuditHash(phoneNumber),
        provider: "FAST2SMS",
        reason: error instanceof OtpProviderError ? error.code : "OTP_PROVIDER_UNAVAILABLE",
        requestId: context.requestId
      }));
      throw this.providerHttpError(error);
    }
  }

  async verifyPhoneOtp(
    dto: VerifyPhoneOtpDto,
    context: RequestContext,
    response: Response
  ) {
    this.assertPhoneCheckoutEnabled();
    const phoneNumber = this.phones.normalizeIndianMobile(dto.phoneNumber);
    await this.enforcePhoneOtpVerifyLimits(phoneNumber, context);
    const proof = this.crypto.randomBase64Url(32);
    const result = await this.repository.prisma.$transaction(async (tx) => {
      const flow = await this.lockCheckoutFlow(tx, dto.flowToken);
      this.assertFlowUsableForOtp(flow, phoneNumber, context);
      const otp = await this.lockPendingPhoneOtp(tx, flow.id, phoneNumber, dto.otpRequestId);
      if (!otp) {
        await this.password.verify(dto.otp, null);
        return { ok: false as const, reason: "not_found", blockedUntil: null as Date | null };
      }

      const now = new Date();
      if (otp.blocked_until && otp.blocked_until > now) {
        return { ok: false as const, reason: "blocked", blockedUntil: otp.blocked_until };
      }
      if (otp.expires_at <= now) {
        await tx.phoneOtpVerification.update({
          where: { id: otp.id },
          data: {
            attemptCount: { increment: 1 },
            lastAttemptAt: now,
            status: PhoneOtpStatus.EXPIRED
          }
        });
        return { ok: false as const, reason: "expired", blockedUntil: null };
      }

      const otpHash = this.otp.hashPhone(dto.otp, phoneNumber, otp.otp_nonce);
      const nextAttemptCount = otp.attempt_count + 1;
      const maxAttempts = this.config.get<number>("PHONE_OTP_MAX_ATTEMPTS", 5);
      if (!this.crypto.timingSafeEqual(otpHash, otp.otp_hash)) {
        const blocked = nextAttemptCount >= maxAttempts;
        const blockedUntil = blocked
          ? this.secondsFromNow(this.config.get<number>("PHONE_OTP_BLOCK_SECONDS", 900))
          : null;
        await tx.phoneOtpVerification.update({
          where: { id: otp.id },
          data: {
            attemptCount: nextAttemptCount,
            blockedUntil,
            lastAttemptAt: now,
            status: blocked ? PhoneOtpStatus.BLOCKED : PhoneOtpStatus.PENDING
          }
        });
        return { ok: false as const, reason: blocked ? "blocked" : "invalid", blockedUntil };
      }

      await tx.phoneOtpVerification.update({
        where: { id: otp.id },
        data: {
          attemptCount: nextAttemptCount,
          lastAttemptAt: now,
          status: PhoneOtpStatus.VERIFIED
        }
      });
      await tx.checkoutOnboardingFlow.update({
        where: { id: flow.id },
        data: {
          phoneProofHash: this.checkoutProofHash(proof, flow.id, phoneNumber, context),
          phoneVerifiedAt: now,
          status: CheckoutOnboardingFlowStatus.PHONE_VERIFIED
        }
      });
      return { ok: true as const, flowId: flow.id };
    }, AUTH_TRANSACTION_OPTIONS);

    if (!result.ok) {
      this.audit.record({
        eventType: result.reason === "blocked" ? "otp.blocked" : result.reason === "expired" ? "otp.expired" : "otp.failed",
        outcome: AuditOutcome.FAILURE,
        ip: context.ip,
        requestId: context.requestId,
        metadata: {
          reason: result.reason,
          phoneHash: this.phoneAuditHash(phoneNumber)
        } as Prisma.InputJsonObject
      });
      if (result.reason === "blocked" && result.blockedUntil) {
        this.observability.recordOtpBlocked("verify");
        throw this.tooManyOtpAttempts(result.blockedUntil);
      }
      throw new UnauthorizedException({
        code: result.reason === "expired" ? "PHONE_OTP_EXPIRED" : "PHONE_OTP_INVALID",
        message: result.reason === "expired"
          ? "The verification code expired. Request a new code."
          : "That code is invalid. Check the SMS and try again."
      });
    }

    this.setCheckoutPhoneProofCookie(response, proof);
    this.observability.recordOtpVerified("FAST2SMS");
    this.audit.record({
      eventType: "otp.verified",
      outcome: AuditOutcome.SUCCESS,
      ip: context.ip,
      requestId: context.requestId,
      metadata: {
        flowId: result.flowId,
        phoneHash: this.phoneAuditHash(phoneNumber)
      } as Prisma.InputJsonObject
    });
    this.logger.log(JSON.stringify({
      event: "otp.verified",
      flowId: result.flowId,
      outcome: "success",
      phoneHash: this.phoneAuditHash(phoneNumber),
      provider: "FAST2SMS",
      requestId: context.requestId
    }));
    return {
      verified: true,
      passwordSetupPath: `/auth/checkout-password?${new URLSearchParams({ flow: dto.flowToken }).toString()}`
    };
  }

  async phoneSignup(
    dto: PhoneSignupDto,
    context: RequestContext,
    proofCookie: string | undefined,
    response: Response
  ) {
    const timer = this.performance.start("phone_signup", response);
    let actorUserId: string | undefined;
    this.assertPhoneCheckoutEnabled();
    try {
      if (!proofCookie) {
        this.recordProofFailure(context, "missing");
        throw new ForbiddenException({
          code: "PHONE_PROOF_REQUIRED",
          message: "Verify your phone number before creating a password."
        });
      }

      const passwordHashPromise = timer.time("password_hash", () => this.password.hash(dto.password));
      void passwordHashPromise.catch(() => undefined);
      let user: User;
      try {
        user = await timer.time("signup_transaction", () =>
          this.repository.prisma.$transaction(async (tx) => {
            const flow = await timer.time("flow_lock", () => this.lockCheckoutFlow(tx, dto.flowToken));
            this.assertFlowReadyForSignup(flow, proofCookie, context);
            const address = this.decryptCheckoutPayload(flow.address_ciphertext, flow.address_nonce);
            const signupEmail = address.email ? this.normalizeEmail(address.email) : this.shadowEmailForPhone(flow.phone_number);
            const existing = await timer.time("phone_duplicate_check", () =>
              tx.user.findFirst({
                where: {
                  phone: flow.phone_number,
                  deletedAt: null,
                  status: { not: UserStatus.DELETED }
                },
                select: { id: true }
              })
            );
            if (existing) {
              this.audit.record({
                eventType: "auth.phone_recycle_or_duplicate_detected",
                actorUserId: existing.id,
                outcome: AuditOutcome.FAILURE,
                ip: context.ip,
                requestId: context.requestId,
                metadata: {
                  flowId: flow.id,
                  phoneHash: this.phoneAuditHash(flow.phone_number),
                  stage: "signup"
                } as Prisma.InputJsonObject
              });
              throw new ConflictException({
                code: "PHONE_ALREADY_REGISTERED",
                message: "This phone number already has an account. Log in to continue checkout."
              });
            }

            const passwordHash = await passwordHashPromise;
            const fullName = this.sanitizeName(address.recipientName || "Lotzi customer");
            const created = await timer.time("account_bundle_create", () =>
              tx.user.create({
                data: {
                  email: signupEmail,
                  emailVerified: false,
                  fullName,
                  passwordHash,
                  phone: flow.phone_number,
                  phoneVerifiedAt: new Date(),
                  providerType: UserProviderType.EMAIL,
                  status: UserStatus.ACTIVE,
                  customerProfile: {
                    create: {
                      displayName: fullName,
                      phone: flow.phone_number
                    }
                  },
                  userRoles: {
                    create: {
                      role: { connect: { code: ROLE_CODES.CUSTOMER } }
                    }
                  },
                  addresses: {
                    create: {
                      label: address.label?.trim() || "Home",
                      recipientName: address.recipientName?.trim() || fullName,
                      recipientPhone: flow.phone_number,
                      line1: address.line1.trim(),
                      line2: address.line2?.trim() || null,
                      city: address.city.trim(),
                      state: address.state.trim(),
                      pincode: address.pincode.trim(),
                      latitude: address.latitude,
                      longitude: address.longitude,
                      deliveryInstructions: address.deliveryInstructions?.trim() || null,
                      isDefault: true
                    }
                  }
                }
              })
            );
            await timer.time("flow_complete", () =>
              Promise.all([
                tx.phoneOtpVerification.updateMany({
                  where: { flowId: flow.id, status: PhoneOtpStatus.VERIFIED },
                  data: { status: PhoneOtpStatus.CONSUMED, userId: created.id }
                }),
                tx.checkoutOnboardingFlow.update({
                  where: { id: flow.id },
                  data: {
                    consumedAt: new Date(),
                    status: CheckoutOnboardingFlowStatus.COMPLETED
                  }
                })
              ]).then(() => undefined)
            );
            return created;
          }, AUTH_TRANSACTION_OPTIONS)
        );
      } catch (error) {
        if (!this.isUniqueConstraintError(error)) {
          throw error;
        }
        const flow = await timer.time("conflict_flow_lookup", () =>
          this.repository.prisma.checkoutOnboardingFlow.findUnique({
            where: { flowTokenHash: this.checkoutHash(dto.flowToken) },
            select: { id: true, phoneNumber: true }
          })
        );
        const isEmailConflict = this.uniqueConstraintTargets(error).includes("email");
        this.audit.record({
          eventType: isEmailConflict ? "auth.email_duplicate_detected" : "auth.phone_recycle_or_duplicate_detected",
          outcome: AuditOutcome.FAILURE,
          ip: context.ip,
          requestId: context.requestId,
          metadata: {
            flowId: flow?.id,
            phoneHash: flow?.phoneNumber ? this.phoneAuditHash(flow.phoneNumber) : undefined,
            stage: "signup_unique_constraint"
          } as Prisma.InputJsonObject
        });
        throw new ConflictException({
          code: isEmailConflict ? "EMAIL_ALREADY_REGISTERED" : "PHONE_ALREADY_REGISTERED",
          message: isEmailConflict
            ? "This email already has an account. Log in to continue checkout."
            : "This phone number already has an account. Log in to continue checkout."
        });
      }

      actorUserId = user.id;
      const routeState = this.customerRouteState(user);
      const createdSession = await this.sessionService.create(user, context, response, timer, { persistent: true });
      await timer.time("auth_cache_prime", () => this.primeEssentialAuthCaches(createdSession.session, routeState));
      const session = this.sessionPayloadFromRouteState(routeState, createdSession.access.expiresAt, createdSession.session.id);
      this.clearCheckoutPhoneProofCookie(response);
      this.audit.record({
        eventType: "auth.phone_signup.created",
        actorUserId: user.id,
        outcome: AuditOutcome.SUCCESS,
        ip: context.ip,
        requestId: context.requestId,
        sessionId: session.sessionId,
        metadata: { phoneHash: this.phoneAuditHash(user.phone ?? "") } as Prisma.InputJsonObject
      });
      return session;
    } finally {
      timer.end({ actorUserId });
    }
  }

  async login(dto: LoginDto, context: RequestContext, response: Response) {
    const timer = this.performance.start("login", response);
    const identifier = this.normalizeLoginIdentifier(dto.email);
    const actor = identifier.kind === "phone" ? `phone:${this.phoneAuditHash(identifier.value)}` : identifier.value;
    let actorUserId: string | undefined;
    try {
      await timer.time("rate_limit", () => this.enforceLoginLimits(identifier.value, context));

      const user = await timer.time("user_lookup", () =>
        identifier.kind === "phone"
          ? this.users.findByPhone(identifier.value)
          : this.users.findByEmail(identifier.value)
      );
      actorUserId = user?.id;
      const validPassword = await timer.time("password_verify", () =>
        this.password.verify(dto.password, user?.passwordHash)
      );
      const now = new Date();

      if (
        !user ||
        !validPassword ||
        user.status !== UserStatus.ACTIVE ||
        (user.lockedUntil && user.lockedUntil > now)
      ) {
        if (user) {
          await timer.time("failed_login_update", () => this.recordFailedLogin(user, context));
        }
        this.audit.record({
          eventType: "auth.login.failed",
          actor,
          actorUserId: user?.id,
          outcome: AuditOutcome.FAILURE,
          ip: context.ip,
          requestId: context.requestId
        });
        throw new UnauthorizedException("Invalid credentials.");
      }

      const persistent = this.persistentLoginRequested(dto);
      const [updated, created, routeState] = await Promise.all([
        timer.time("login_update", () =>
          this.repository.prisma.user.update({
            where: { id: user.id },
            data: {
              failedAttempts: 0,
              lockedUntil: null,
              lastLoginAt: now,
              loginCount: { increment: 1 }
            }
          })
        ),
        timer.time("session_create", () =>
          this.sessionService.create(user, context, response, undefined, { persistent })
        ),
        timer.time("route_state_query", () => this.authState.getRouteState(user.id))
      ]);
      await timer.time("auth_cache_prime", () => this.primeAuthCaches(created.session, routeState));
      const session = this.sessionPayloadFromRouteState(
        routeState,
        created.access.expiresAt,
        created.session.id
      );
      this.audit.record({
        eventType: "auth.login.succeeded",
        actor,
        actorUserId: updated.id,
        outcome: AuditOutcome.SUCCESS,
        ip: context.ip,
        requestId: context.requestId,
        sessionId: session.sessionId,
        metadata: {
          deviceFingerprint: context.deviceFingerprint,
          persistent
        }
      });
      return session;
    } finally {
      timer.end({ actor, actorUserId });
    }
  }

  async googleLogin(dto: GoogleLoginDto, context: RequestContext, response: Response) {
    this.rejectMerchantGoogleIntent(dto);
    const identity = await this.verifyGoogleIdentity(dto.idToken);
    const intent: SignupIntent = { accountType: "CUSTOMER" };
    const mapped = await this.identityProviders.findByProviderUserId(
      IdentityProviderName.GOOGLE,
      identity.providerUserId
    );

    if (mapped) {
      await this.identityProviders.markLogin(mapped.id);
      const user = await this.completeGoogleOnboarding(mapped.user.id, identity.email, intent);
      const session = await this.createSession(user, context, response);
      this.audit.record({
        eventType: "auth.google.login",
        actor: identity.email,
        actorUserId: user.id,
        outcome: AuditOutcome.SUCCESS,
        ip: context.ip,
        requestId: context.requestId,
        sessionId: session.sessionId,
        metadata: { accountType: intent.accountType }
      });
      return session;
    }

    const emailUser = await this.users.findByEmail(identity.email);
    if (emailUser) {
      if (emailUser.passwordHash) {
        throw new ConflictException({
          code: "LINK_REQUIRED",
          message: "This email already has a password account. Re-authenticate to link Google."
        });
      }
      throw new ConflictException({
        code: "PROVIDER_CONFLICT",
        message: "This email is already associated with another provider state."
      });
    }

    const user = await this.repository.prisma.$transaction(
      async (tx) => {
        const created = await this.users.createGoogleUser(
          {
            email: identity.email,
            fullName: identity.name,
            avatarUrl: identity.picture
          },
          tx
        );
        await this.identityProviders.linkGoogle(
          {
            userId: created.id,
            providerEmail: identity.email,
            providerUserId: identity.providerUserId,
            metadata: { picture: identity.picture }
          },
          tx
        );
        await this.completeSignupOnboarding(created, intent, tx);
        return tx.user.findUniqueOrThrow({ where: { id: created.id } });
      },
      AUTH_TRANSACTION_OPTIONS
    );

    const session = await this.createSession(user, context, response);
    this.audit.record({
      eventType: "auth.google.signup",
      actor: identity.email,
      actorUserId: user.id,
      outcome: AuditOutcome.SUCCESS,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: session.sessionId,
      metadata: { accountType: intent.accountType }
    });
    return session;
  }

  async linkGoogle(dto: GoogleLinkDto, context: RequestContext, response: Response) {
    const identity = await this.verifyGoogleIdentity(dto.idToken);
    const existingMapping = await this.identityProviders.findByProviderUserId(
      IdentityProviderName.GOOGLE,
      identity.providerUserId
    );
    if (existingMapping) {
      throw new ConflictException({
        code: "PROVIDER_ALREADY_LINKED",
        message: "This Google account is already linked."
      });
    }

    const user = await this.users.findByEmail(identity.email);
    const passwordOk = await this.password.verify(dto.password, user?.passwordHash);
    if (!user || !user.passwordHash || !passwordOk) {
      throw new UnauthorizedException("Invalid credentials.");
    }

    const linked = await this.repository.prisma.$transaction(
      async (tx) => {
        await this.identityProviders.linkGoogle(
          {
            userId: user.id,
            providerEmail: identity.email,
            providerUserId: identity.providerUserId,
            metadata: { picture: identity.picture }
          },
          tx
        );
        await this.customerCreation.ensureCustomer(
          {
            userId: user.id,
            displayName: user.fullName,
            phone: user.phone
          },
          tx
        );
        return tx.user.update({
          where: { id: user.id },
          data: {
            providerType: UserProviderType.MULTI,
            emailVerified: true,
            status: UserStatus.ACTIVE
          }
        });
      },
      AUTH_TRANSACTION_OPTIONS
    );

    const session = await this.createSession(linked, context, response);
    this.audit.record({
      eventType: "auth.google.linked",
      actor: identity.email,
      actorUserId: user.id,
      outcome: AuditOutcome.SUCCESS,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: session.sessionId
    });
    return session;
  }

  async requestPasswordReset(dto: PasswordResetRequestDto, context: RequestContext) {
    const email = this.normalizeEmail(dto.email);
    await this.rateLimit.enforce(`reset:email:${email}`, 3, 60 * 60);
    await this.rateLimit.enforce(`reset:ip:${context.ip ?? "unknown"}`, 10, 60 * 60);
    const user = await this.users.findByEmail(email);

    if (user?.status === UserStatus.ACTIVE && user.passwordHash) {
      const selector = this.crypto.randomBase64Url(RESET_SELECTOR_BYTES);
      const verifier = this.crypto.randomBase64Url(RESET_VERIFIER_BYTES);
      const nonce = this.crypto.randomBase64Url(16);
      const verifierHash = this.passwordResetHash(selector, verifier, nonce);
      await this.repository.prisma.passwordReset.create({
        data: {
          userId: user.id,
          selector,
          verifierHash,
          verifierNonce: nonce,
          requestedIp: context.ip,
          userAgentHash: this.crypto.hmac(
            context.userAgent ?? "",
            this.crypto.pepper("DEVICE_FINGERPRINT_PEPPER")
          ),
          expiresAt: this.minutesFromNow(30)
        }
      });
      const token = `${selector}.${verifier}`;
      const resetUrl = this.passwordResetUrl(token);
      await this.mail.sendPasswordReset(email, resetUrl, `password-reset:${selector}`);
    }

    this.audit.record({
      eventType: "auth.password_reset.requested",
      actor: email,
      actorUserId: user?.id,
      outcome: AuditOutcome.PENDING,
      ip: context.ip,
      requestId: context.requestId
    });

    return { status: "ACCEPTED" };
  }

  async confirmPasswordReset(dto: PasswordResetConfirmDto, context: RequestContext) {
    const [selector, verifier] = dto.token.split(".");
    if (!selector || !verifier) {
      throw new UnauthorizedException("Invalid or expired reset token.");
    }

    const reset = await this.repository.prisma.passwordReset.findUnique({
      where: { selector },
      include: { user: true }
    });

    const computed = reset
      ? this.passwordResetHash(selector, verifier, reset.verifierNonce)
      : this.passwordResetHash(selector, verifier, this.crypto.randomBase64Url(16));

    if (
      !reset ||
      reset.consumedAt ||
      reset.expiresAt <= new Date() ||
      !this.crypto.timingSafeEqual(computed, reset.verifierHash)
    ) {
      throw new UnauthorizedException("Invalid or expired reset token.");
    }

    const passwordHash = await this.password.hash(dto.newPassword);
    let revokedSessionIds: string[] = [];
    await this.repository.prisma.$transaction(
      async (tx) => {
        revokedSessionIds = (await this.sessions.listActiveIdsForUser(reset.userId, tx)).map((session) => session.id);
        await tx.user.update({
          where: { id: reset.userId },
          data: {
            passwordHash,
            passwordChangedAt: new Date(),
            authzVersion: { increment: 1 },
            failedAttempts: 0,
            lockedUntil: null,
            status: UserStatus.ACTIVE
          }
        });
        await tx.passwordReset.update({
          where: { id: reset.id },
          data: { consumedAt: new Date() }
        });
        await tx.session.updateMany({
          where: { userId: reset.userId, revoked: false },
          data: {
            revoked: true,
            revokedAt: new Date(),
            revokedReason: SessionRevokedReason.PASSWORD_RESET
          }
        });
      },
      AUTH_TRANSACTION_OPTIONS
    );
    await Promise.all([
      this.authStateInvalidator.invalidateSessions(revokedSessionIds),
      this.authStateInvalidator.invalidateUserVersions(reset.userId, [
        reset.user.authzVersion,
        reset.user.authzVersion + 1
      ])
    ]);

    await this.mail.sendPasswordChangedNotice(reset.user.email);
    this.audit.record({
      eventType: "auth.password_reset.completed",
      actor: reset.user.email,
      actorUserId: reset.user.id,
      outcome: AuditOutcome.SUCCESS,
      ip: context.ip,
      requestId: context.requestId
    });
    return { status: "PASSWORD_RESET" };
  }

  async refresh(
    refreshToken: string | undefined,
    clientSecret: string | undefined,
    context: RequestContext,
    response: Response
  ) {
    const started = Date.now();
    const timer = this.performance.start("refresh", response);
    let actorUserId: string | undefined;
    try {
      if (!refreshToken) {
        this.observability.recordAuthRefreshInvalid("missing");
        throw authUnauthorized(AUTH_REFRESH_MISSING, "Missing refresh token.");
      }

      const tokenStarted = Date.now();
      const parsed = this.tokens.parseRefreshToken(refreshToken);
      const oldHash = this.tokens.hashRefreshToken(refreshToken);
      timer.record("token_parse_hash", Date.now() - tokenStarted);

      const session = await timer.time("session_lookup", () => this.sessions.findByRefreshHash(oldHash));
      if (!session) {
        return await this.handleConsumedOrInvalidRefresh({
          refreshTokenHash: oldHash,
          parsedRefreshTokenJti: parsed.version === "v2" ? parsed.jti : undefined,
          clientSecret,
          context,
          response,
          reason: "refresh_hash_not_active"
        });
      }
      actorUserId = session.userId;

      await timer.time("rate_limit", () => this.rateLimit.enforce(`refresh:session:${session.id}`, 30, 60));
      const binding = this.resolveClientBinding(session, clientSecret);
      if (!binding) {
        return await this.revokeActiveSessionRefresh({
          session,
          context,
          response,
          reason: "client_binding_mismatch"
        });
      }

      if (session.refreshTokenJti) {
        if (parsed.version !== "v2" || parsed.jti !== session.refreshTokenJti) {
          return await this.revokeActiveSessionRefresh({
            session,
            context,
            response,
            reason: "refresh_jti_mismatch"
          });
        }
      }

      const nextParentJti = parsed.version === "v2" ? parsed.jti : (session.refreshTokenJti ?? "root");
      const nextRefresh = this.tokens.issueRefreshToken(nextParentJti);
      const nextRefreshIssuedAt = new Date();
      const expiresAt = this.daysFromNow(this.config.get<number>("REFRESH_TOKEN_TTL_DAYS", 30));
      const rotated = await timer.time("refresh_rotate_tx", () =>
        this.sessions.rotateRefreshToken({
          sessionId: session.id,
          oldHash,
          newHash: this.tokens.hashRefreshToken(nextRefresh.token),
          expiresAt,
          refreshTokenJti: nextRefresh.jti,
          refreshTokenParentJti: nextRefresh.parentJti,
          refreshTokenIssuedAt: nextRefreshIssuedAt,
          clientSecretHash: binding.hash,
          consumedRefreshTokenJti: parsed.version === "v2" ? parsed.jti : session.refreshTokenJti ?? undefined,
          replacementRefreshTokenJti: nextRefresh.jti,
          deviceFingerprint: context.deviceFingerprint
        }).catch(async (error: unknown) => {
          if (error instanceof Error && error.message.includes("no longer refreshable")) {
            return this.handleConsumedOrInvalidRefresh({
              refreshTokenHash: oldHash,
              parsedRefreshTokenJti: parsed.version === "v2" ? parsed.jti : undefined,
              clientSecret,
              context,
              response,
              reason: "concurrent_rotation"
            });
          }
          throw error;
        })
      );

      const [access, routeState] = await Promise.all([
        timer.time("access_token_issue", () => this.tokens.issueAccessToken({
          userId: rotated.user.id,
          sessionId: rotated.id,
          tokenFamilyId: rotated.tokenFamilyId,
          authzVersion: rotated.user.authzVersion
        })),
        timer.time("route_state_query", () =>
          this.authState.getCachedOrLoadRouteState(rotated.user.id, rotated.user.authzVersion)
        )
      ]);
      const cookieStarted = Date.now();
      this.tokens.setAuthCookies(response, access.token, nextRefresh.token, rotated.id, access.expiresAt, {
        persistent: rotated.persistent ?? true,
        clientSecret: binding.secret
      });
      timer.record("set_cookies", Date.now() - cookieStarted);
      await timer.time("auth_cache_prime", () => this.primeAuthCaches(rotated, routeState));
      return this.sessionPayloadFromRouteState(routeState, access.expiresAt, rotated.id);
    } finally {
      this.observability.observeAuthRefreshLatency(Date.now() - started);
      timer.end({ actorUserId });
    }
  }

  private resolveClientBinding(
    session: { clientSecretHash?: string | null },
    clientSecret: string | undefined
  ): { secret: string; hash: string } | null {
    if (session.clientSecretHash) {
      if (!clientSecret) {
        return null;
      }
      const hash = this.tokens.hashClientSecret(clientSecret);
      return this.crypto.timingSafeEqual(hash, session.clientSecretHash)
        ? { secret: clientSecret, hash }
        : null;
    }

    const secret = clientSecret ?? this.tokens.newClientSecret();
    return { secret, hash: this.tokens.hashClientSecret(secret) };
  }

  private async handleConsumedOrInvalidRefresh(input: {
    refreshTokenHash: string;
    parsedRefreshTokenJti?: string;
    clientSecret?: string;
    context: RequestContext;
    response: Response;
    reason: string;
  }): Promise<never> {
    const consumed = await this.sessions.findConsumedRefresh(input.refreshTokenHash);
    if (consumed) {
      const currentSession = await this.sessions.findActiveById(consumed.sessionId);
      if (
        input.parsedRefreshTokenJti &&
        currentSession &&
        this.isDirectParentRefreshRace({
          consumed,
          currentSession,
          parsedRefreshTokenJti: input.parsedRefreshTokenJti,
          clientSecret: input.clientSecret,
          context: input.context
        })
      ) {
        this.observability.recordAuthRefreshRace("direct_parent");
        this.logger.warn(
          JSON.stringify({
            event: "auth.refresh_race",
            requestId: input.context.requestId,
            sessionId: consumed.sessionId,
            tokenFamilyId: consumed.tokenFamilyId,
            reason: "direct_parent"
          })
        );
        this.audit.record({
          eventType: "auth.refresh.race",
          actorUserId: consumed.userId,
          outcome: AuditOutcome.PENDING,
          ip: input.context.ip,
          requestId: input.context.requestId,
          sessionId: consumed.sessionId,
          metadata: { tokenFamilyId: consumed.tokenFamilyId }
        });
        throw authRefreshRace();
      }

      await this.revokeConsumedRefreshFamily(consumed, input.context, input.reason);
      this.tokens.clearAuthCookies(input.response);
      throw authUnauthorized(AUTH_REFRESH_INVALID, "Invalid refresh token.");
    }

    this.observability.recordAuthRefreshInvalid(input.reason);
    this.logger.warn(
      JSON.stringify({
        event: "auth.refresh_invalid",
        requestId: input.context.requestId,
        reason: input.reason
      })
    );
    this.tokens.clearAuthCookies(input.response);
    throw authUnauthorized(AUTH_REFRESH_INVALID, "Invalid refresh token.");
  }

  private isDirectParentRefreshRace(input: {
    consumed: {
      sessionId: string;
      tokenFamilyId: string;
      refreshTokenJti?: string | null;
      replacementRefreshTokenJti?: string | null;
      deviceFingerprint?: string | null;
    };
    currentSession: {
      id: string;
      tokenFamilyId: string;
      revoked: boolean;
      expiresAt: Date;
      refreshTokenJti?: string | null;
      refreshTokenParentJti?: string | null;
      refreshTokenIssuedAt?: Date | null;
      clientSecretHash?: string | null;
      deviceFingerprint: string;
    };
    parsedRefreshTokenJti: string;
    clientSecret?: string;
    context: RequestContext;
  }): boolean {
    const { consumed, currentSession } = input;
    const issuedAt = currentSession.refreshTokenIssuedAt?.getTime();
    if (
      currentSession.revoked ||
      currentSession.expiresAt <= new Date() ||
      currentSession.id !== consumed.sessionId ||
      currentSession.tokenFamilyId !== consumed.tokenFamilyId ||
      !currentSession.refreshTokenJti ||
      !currentSession.refreshTokenParentJti ||
      !issuedAt
    ) {
      return false;
    }

    const raceWindowMs = this.config.get<number>("AUTH_REFRESH_RACE_WINDOW_MS", 10_000);
    const clientSecretHash = input.clientSecret
      ? this.tokens.hashClientSecret(input.clientSecret)
      : undefined;

    return (
      consumed.refreshTokenJti === input.parsedRefreshTokenJti &&
      consumed.refreshTokenJti === currentSession.refreshTokenParentJti &&
      consumed.replacementRefreshTokenJti === currentSession.refreshTokenJti &&
      Date.now() - issuedAt <= raceWindowMs &&
      consumed.deviceFingerprint === input.context.deviceFingerprint &&
      currentSession.deviceFingerprint === input.context.deviceFingerprint &&
      Boolean(clientSecretHash && currentSession.clientSecretHash) &&
      this.crypto.timingSafeEqual(clientSecretHash!, currentSession.clientSecretHash!)
    );
  }

  private async revokeConsumedRefreshFamily(
    consumed: {
      id: string;
      userId: string;
      sessionId: string;
      tokenFamilyId: string;
    },
    context: RequestContext,
    reason: string
  ): Promise<void> {
    const activeSessionIds = await this.sessions.listActiveIdsForTokenFamily(consumed.tokenFamilyId);
    await this.sessions.revokeTokenFamily(
      consumed.tokenFamilyId,
      SessionRevokedReason.TOKEN_REUSE
    );
    await this.authStateInvalidator.invalidateSessions(
      activeSessionIds.map((activeSession) => activeSession.id)
    );
    await this.sessions.markConsumedRefreshReuse(consumed.id);
    this.observability.refreshReuse.inc();
    this.observability.recordAuthRefreshInvalid(reason);
    this.logger.warn(
      JSON.stringify({
        event: "auth.refresh_invalid",
        requestId: context.requestId,
        sessionId: consumed.sessionId,
        tokenFamilyId: consumed.tokenFamilyId,
        reason
      })
    );
    this.audit.record({
      eventType: "auth.refresh.reuse_detected",
      actorUserId: consumed.userId,
      outcome: AuditOutcome.DENIED,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: consumed.sessionId,
      metadata: { tokenFamilyId: consumed.tokenFamilyId, reason }
    });
  }

  private async revokeActiveSessionRefresh(input: {
    session: {
      id: string;
      userId: string;
      tokenFamilyId: string;
    };
    context: RequestContext;
    response: Response;
    reason: string;
  }): Promise<never> {
    const activeSessionIds = await this.sessions.listActiveIdsForTokenFamily(input.session.tokenFamilyId);
    await this.sessions.revokeTokenFamily(
      input.session.tokenFamilyId,
      SessionRevokedReason.TOKEN_REUSE
    );
    await this.authStateInvalidator.invalidateSessions(
      activeSessionIds.map((activeSession) => activeSession.id)
    );
    this.observability.recordAuthRefreshInvalid(input.reason);
    this.logger.warn(
      JSON.stringify({
        event: "auth.refresh_invalid",
        requestId: input.context.requestId,
        sessionId: input.session.id,
        tokenFamilyId: input.session.tokenFamilyId,
        reason: input.reason
      })
    );
    this.audit.record({
      eventType: "auth.refresh.reuse_detected",
      actorUserId: input.session.userId,
      outcome: AuditOutcome.DENIED,
      ip: input.context.ip,
      requestId: input.context.requestId,
      sessionId: input.session.id,
      metadata: { tokenFamilyId: input.session.tokenFamilyId, reason: input.reason }
    });
    this.tokens.clearAuthCookies(input.response);
    throw authUnauthorized(AUTH_REFRESH_INVALID, "Invalid refresh token.");
  }

  recordRejectedRedirect(dto: RejectedRedirectDto, context: RequestContext) {
    this.audit.record({
      eventType: "auth.redirect.rejected",
      outcome: AuditOutcome.DENIED,
      ip: context.ip,
      requestId: context.requestId,
      sessionId: dto.sessionId,
      metadata: {
        value: dto.value,
        reason: dto.reason
      }
    });
    return { status: "RECORDED" };
  }

  async logout(refreshToken: string | undefined, response: Response) {
    if (refreshToken) {
      const hash = this.tokens.hashRefreshToken(refreshToken);
      const session = await this.sessions.findByRefreshHash(hash);
      if (session) {
        await this.sessions.revokeSession(session.id, SessionRevokedReason.LOGOUT);
        await this.authStateInvalidator.invalidateSessions([session.id]);
      }
    }
    this.tokens.clearAuthCookies(response);
    return { status: "LOGGED_OUT" };
  }

  async session(auth: AuthenticatedPrincipal, response?: Response) {
    const timer = this.performance.start("session", response);
    try {
      const routeState =
        auth.routeState ??
        (await timer.time("route_state_query", () =>
          this.authState.getCachedOrLoadRouteState(auth.userId, auth.authzVersion)
        ));
      return this.sessionPayloadFromRouteState(
        routeState,
        new Date(Date.now() + 15 * 60 * 1000),
        auth.sessionId
      );
    } finally {
      timer.end({ actorUserId: auth.userId });
    }
  }

  listSessions(userId: string) {
    return this.sessions.listActiveForUser(userId);
  }

  async revokeSession(userId: string, sessionId: string) {
    const result = await this.repository.prisma.session.updateMany({
      where: { id: sessionId, userId, revoked: false },
      data: {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: SessionRevokedReason.USER_REVOKED
      }
    });
    if (result.count > 0) {
      await this.authStateInvalidator.invalidateSessions([sessionId]);
    }
    return { status: "REVOKED" };
  }

  private async completeGoogleOnboarding(
    userId: string,
    email: string,
    intent: SignupIntent
  ) {
    return this.repository.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        await this.completeSignupOnboarding(user, intent, tx);
        return tx.user.findUniqueOrThrow({ where: { id: userId } });
      },
      AUTH_TRANSACTION_OPTIONS
    );
  }

  private async completeSignupOnboarding(
    user: User,
    intent: SignupIntent,
    tx: Prisma.TransactionClient
  ) {
    await this.customerCreation.ensureCustomer(
      {
        userId: user.id,
        displayName: user.fullName,
        phone: user.phone
      },
      tx
    );

    if (intent.accountType === "MERCHANT") {
      if (!intent.storeName) {
        throw new BadRequestException("Store name is required for merchant signup.");
      }
      await this.merchantCreation.ensureMerchantProfile(
        {
          userId: user.id,
          businessName: intent.storeName
        },
        tx
      );
      await this.storeCreation.ensurePendingStoreForMerchant(
        {
          ownerUserId: user.id,
          storeName: intent.storeName,
          email: user.email,
          phone: user.phone
        },
        tx
      );
    }
  }

  private async createSession(
    user: User,
    context: RequestContext,
    response: Response,
    timer?: AuthRequestTimer,
    _roleCodes?: string[],
    options: { persistent?: boolean } = {}
  ) {
    const created = await this.sessionService.create(user, context, response, timer, options);
    const routeState = timer
      ? await timer.time("route_state_query", () => this.authState.getRouteState(user.id))
      : await this.authState.getRouteState(user.id);
    if (timer) {
      await timer.time("auth_cache_prime", () => this.primeAuthCaches(created.session, routeState));
    } else {
      await this.primeAuthCaches(created.session, routeState);
    }
    return this.sessionPayloadFromRouteState(routeState, created.access.expiresAt, created.session.id);
  }

  private sessionPayloadFromRouteState(
    routeState: AuthRouteState,
    accessExpiresAt: Date,
    sessionId: string
  ): SessionPayload & { sessionId: string } {
    return {
      user: this.publicUserFromRouteState(routeState),
      sessionId,
      accessTokenExpiresAt: accessExpiresAt.toISOString(),
      routeState: {
        merchantStoreId: routeState.merchantStoreId,
        merchantStoreStatus: routeState.merchantStoreStatus,
        onboardingState: routeState.onboardingState,
        onboardingComplete: routeState.onboardingComplete,
        redirectTo: routeState.redirectTo
      },
      redirectTo: routeState.redirectTo
    };
  }

  private customerRouteState(user: User): AuthRouteState {
    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        status: user.status,
        emailVerified: user.emailVerified,
        authzVersion: user.authzVersion
      },
      roleCodes: [ROLE_CODES.CUSTOMER],
      merchantStoreId: null,
      merchantStoreStatus: null,
      onboardingState: null,
      onboardingComplete: false,
      redirectTo: "/"
    };
  }

  private publicUserFromRouteState(routeState: AuthRouteState): PublicUser {
    const user = routeState.user;
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      status: user.status,
      emailVerified: user.emailVerified,
      authzVersion: user.authzVersion,
      roleCodes: routeState.roleCodes
    };
  }

  private async primeAuthCaches(
    session: {
      id: string;
      userId: string;
      tokenFamilyId: string;
      expiresAt: Date;
    },
    routeState: AuthRouteState
  ): Promise<void> {
    await Promise.all([
      this.sessionCache.set({
        id: session.id,
        userId: session.userId,
        tokenFamilyId: session.tokenFamilyId,
        expiresAt: session.expiresAt.toISOString(),
        user: routeState.user
      }),
      this.authState.cacheRouteState(routeState),
      this.rbac.platformAuthorization(routeState.user.id, routeState.user.authzVersion)
    ]);
  }

  private async primeEssentialAuthCaches(
    session: {
      id: string;
      userId: string;
      tokenFamilyId: string;
      expiresAt: Date;
    },
    routeState: AuthRouteState
  ): Promise<void> {
    await Promise.all([
      this.sessionCache.set({
        id: session.id,
        userId: session.userId,
        tokenFamilyId: session.tokenFamilyId,
        expiresAt: session.expiresAt.toISOString(),
        user: routeState.user
      }),
      this.authState.cacheRouteState(routeState)
    ]);
  }

  private assertPhoneCheckoutEnabled() {
    if (!this.config.get<boolean>("PHONE_CHECKOUT_ONBOARDING_ENABLED", true)) {
      throw new ServiceUnavailableException({
        code: "PHONE_CHECKOUT_ONBOARDING_DISABLED",
        message: "Phone checkout onboarding is not enabled."
      });
    }
  }

  private async enforceCheckoutOnboardingStartLimits(phoneNumber: string, context: RequestContext) {
    const phoneHash = this.phoneAuditHash(phoneNumber);
    await Promise.all([
      this.rateLimit.enforce(`checkout-onboarding:start:phone:${phoneHash}`, 5, 60 * 60),
      this.rateLimit.enforce(`checkout-onboarding:start:device:${context.deviceFingerprint}`, 10, 60 * 60),
      this.rateLimit.enforce(`checkout-onboarding:start:ip:${context.ip ?? "unknown"}`, 40, 60 * 60)
    ]);
  }

  private async enforcePhoneOtpSendLimits(phoneNumber: string, context: RequestContext) {
    const phoneHash = this.phoneAuditHash(phoneNumber);
    await Promise.all([
      this.rateLimit.enforce(`otp:send:phone:${phoneHash}`, 5, 15 * 60),
      this.rateLimit.enforce(`otp:send:device:${context.deviceFingerprint}`, 12, 15 * 60),
      this.rateLimit.enforce(`otp:send:ip:${context.ip ?? "unknown"}`, 40, 15 * 60)
    ]);
  }

  private async enforcePhoneOtpVerifyLimits(phoneNumber: string, context: RequestContext) {
    const phoneHash = this.phoneAuditHash(phoneNumber);
    await Promise.all([
      this.rateLimit.enforce(`otp:verify:phone:${phoneHash}`, 12, 15 * 60),
      this.rateLimit.enforce(`otp:verify:device:${context.deviceFingerprint}`, 25, 15 * 60),
      this.rateLimit.enforce(`otp:verify:ip:${context.ip ?? "unknown"}`, 80, 15 * 60)
    ]);
  }

  private checkoutAddressPayload(dto: CheckoutOnboardingStartDto, phoneNumber: string): CheckoutAddressPayload {
    return {
      email: this.normalizeEmail(dto.email),
      label: dto.label?.trim() || "Home",
      recipientName: dto.recipientName?.trim().replace(/\s+/g, " "),
      recipientPhone: phoneNumber,
      line1: dto.line1.trim(),
      line2: dto.line2?.trim() || undefined,
      city: dto.city.trim(),
      state: dto.state.trim(),
      pincode: dto.pincode.trim(),
      latitude: typeof dto.latitude === "number" && Number.isFinite(dto.latitude) ? dto.latitude : undefined,
      longitude: typeof dto.longitude === "number" && Number.isFinite(dto.longitude) ? dto.longitude : undefined,
      deliveryInstructions: dto.deliveryInstructions?.trim() || undefined,
      isDefault: dto.isDefault ?? true
    };
  }

  private encryptCheckoutPayload(payload: CheckoutAddressPayload): { ciphertext: string; nonce: string } {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.checkoutEncryptionKey(), nonce);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final()
    ]);
    return {
      ciphertext: `${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`,
      nonce: nonce.toString("base64url")
    };
  }

  private decryptCheckoutPayload(ciphertext: string, nonce: string): CheckoutAddressPayload {
    const [body, tag] = ciphertext.split(".");
    if (!body || !tag) {
      throw new ForbiddenException({
        code: "CHECKOUT_FLOW_CORRUPT",
        message: "The checkout onboarding flow is invalid."
      });
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.checkoutEncryptionKey(),
      Buffer.from(nonce, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final()
    ]);
    return JSON.parse(decrypted.toString("utf8")) as CheckoutAddressPayload;
  }

  private checkoutEncryptionKey(): Buffer {
    return createHash("sha256")
      .update(this.config.get<string>("CHECKOUT_ONBOARDING_ENCRYPTION_KEY", "local-dev-checkout-flow-key-change-before-prod-0000"))
      .digest();
  }

  private safeCheckoutNextPath(nextPath: string): string {
    const fallback = "/cart";
    const trimmed = nextPath.trim();
    if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("://")) {
      return fallback;
    }
    try {
      const parsed = new URL(trimmed, "https://lotzi.local");
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return fallback;
    }
  }

  private checkoutOnboardingStartResponse(flowToken: string, phoneNumber: string, expiresAt: Date) {
    const query = new URLSearchParams({ flow: flowToken }).toString();
    return {
      flowToken,
      verifyPhonePath: `/auth/verify-phone?${query}`,
      phoneMasked: this.phones.mask(phoneNumber),
      expiresAt: expiresAt.toISOString()
    };
  }

  private checkoutDeterministicToken(
    idempotencyKey: string,
    phoneNumber: string,
    context: RequestContext
  ): string {
    return this.crypto.hmac(
      ["checkout-flow", idempotencyKey, phoneNumber, context.deviceFingerprint].join(":"),
      this.crypto.pepper("CHECKOUT_PHONE_PROOF_PEPPER")
    );
  }

  private checkoutHash(value: string): string {
    return this.crypto.hmac(value, this.crypto.pepper("CHECKOUT_PHONE_PROOF_PEPPER"));
  }

  private checkoutProofHash(
    proof: string,
    flowId: string,
    phoneNumber: string,
    context: RequestContext
  ): string {
    return this.crypto.hmac(
      ["phone-proof", proof, flowId, phoneNumber, context.deviceFingerprint].join(":"),
      this.crypto.pepper("CHECKOUT_PHONE_PROOF_PEPPER")
    );
  }

  private phoneAuditHash(phoneNumber: string): string {
    return this.crypto.hmac(
      ["phone", phoneNumber].join(":"),
      this.crypto.pepper("CHECKOUT_PHONE_PROOF_PEPPER")
    );
  }

  private async requireMutableCheckoutFlow(
    flowToken: string,
    phoneNumber: string,
    context: RequestContext
  ) {
    const flow = await this.repository.prisma.checkoutOnboardingFlow.findUnique({
      where: { flowTokenHash: this.checkoutHash(flowToken) }
    });
    if (!flow || flow.expiresAt <= new Date() || flow.consumedAt) {
      throw new UnauthorizedException({
        code: "CHECKOUT_FLOW_EXPIRED",
        message: "This checkout onboarding flow expired. Start again from the address step."
      });
    }
    if (flow.deviceFingerprintHash !== this.checkoutHash(context.deviceFingerprint)) {
      this.recordProofFailure(context, "device_mismatch");
      throw new ForbiddenException({
        code: "CHECKOUT_FLOW_DEVICE_MISMATCH",
        message: "This checkout flow must be completed from the same browser session."
      });
    }
    if (flow.phoneNumber !== phoneNumber) {
      this.recordProofFailure(context, "phone_mismatch");
      throw new ForbiddenException({
        code: "CHECKOUT_FLOW_PHONE_MISMATCH",
        message: "Verify the phone number used for this checkout flow."
      });
    }
    return flow;
  }

  private async lockCheckoutFlow(
    tx: Prisma.TransactionClient,
    flowToken: string
  ): Promise<LockedCheckoutFlowRow> {
    const rows = await tx.$queryRaw<LockedCheckoutFlowRow[]>`
      SELECT
        id,
        phone_number,
        phone_proof_hash,
        phone_verified_at,
        address_ciphertext,
        address_nonce,
        next_path,
        status,
        device_fingerprint_hash,
        expires_at,
        consumed_at
      FROM checkout_onboarding_flows
      WHERE flow_token_hash = ${this.checkoutHash(flowToken)}
      FOR UPDATE
    `;
    const flow = rows[0];
    if (!flow) {
      throw new UnauthorizedException({
        code: "CHECKOUT_FLOW_NOT_FOUND",
        message: "This checkout onboarding flow is invalid."
      });
    }
    return flow;
  }

  private assertFlowUsableForOtp(
    flow: LockedCheckoutFlowRow,
    phoneNumber: string,
    context: RequestContext
  ) {
    if (flow.expires_at <= new Date() || flow.consumed_at) {
      throw new UnauthorizedException({
        code: "CHECKOUT_FLOW_EXPIRED",
        message: "This checkout onboarding flow expired. Start again from the address step."
      });
    }
    if (flow.device_fingerprint_hash !== this.checkoutHash(context.deviceFingerprint)) {
      this.recordProofFailure(context, "device_mismatch");
      throw new ForbiddenException({
        code: "CHECKOUT_FLOW_DEVICE_MISMATCH",
        message: "This checkout flow must be completed from the same browser session."
      });
    }
    if (flow.phone_number !== phoneNumber) {
      this.recordProofFailure(context, "phone_mismatch");
      throw new ForbiddenException({
        code: "CHECKOUT_FLOW_PHONE_MISMATCH",
        message: "Verify the phone number used for this checkout flow."
      });
    }
  }

  private async lockPendingPhoneOtp(
    tx: Prisma.TransactionClient,
    flowId: string,
    phoneNumber: string,
    otpRequestId?: string
  ): Promise<LockedPhoneOtpRow | null> {
    const rows = await tx.$queryRaw<LockedPhoneOtpRow[]>(Prisma.sql`
      SELECT id, otp_hash, otp_nonce, attempt_count, blocked_until, expires_at
      FROM phone_otp_verifications
      WHERE flow_id = ${flowId}::uuid
        AND phone_number = ${phoneNumber}
        AND status IN (${PhoneOtpStatus.PENDING}::"PhoneOtpStatus", ${PhoneOtpStatus.BLOCKED}::"PhoneOtpStatus")
        ${otpRequestId ? Prisma.sql`AND otp_reference_id = ${otpRequestId}` : Prisma.empty}
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE
    `);
    return rows[0] ?? null;
  }

  private assertFlowReadyForSignup(
    flow: LockedCheckoutFlowRow,
    proofCookie: string,
    context: RequestContext
  ) {
    this.assertFlowUsableForOtp(flow, flow.phone_number, context);
    if (flow.status !== CheckoutOnboardingFlowStatus.PHONE_VERIFIED || !flow.phone_proof_hash || !flow.phone_verified_at) {
      this.recordProofFailure(context, "not_verified");
      throw new ForbiddenException({
        code: "PHONE_NOT_VERIFIED",
        message: "Verify your phone number before creating a password."
      });
    }
    const proofExpiresAt =
      flow.phone_verified_at.getTime() +
      this.config.get<number>("CHECKOUT_PHONE_PROOF_TTL_SECONDS", 600) * 1000;
    if (proofExpiresAt <= Date.now()) {
      this.recordProofFailure(context, "expired");
      throw new ForbiddenException({
        code: "PHONE_PROOF_EXPIRED",
        message: "Phone verification expired. Verify your phone again."
      });
    }
    const expected = this.checkoutProofHash(proofCookie, flow.id, flow.phone_number, context);
    if (!this.crypto.timingSafeEqual(expected, flow.phone_proof_hash)) {
      this.recordProofFailure(context, "mismatch");
      throw new ForbiddenException({
        code: "PHONE_PROOF_INVALID",
        message: "Verify your phone number before creating a password."
      });
    }
  }

  private phoneOtpResponse(
    otpRequestId: string,
    expiresAt: Date,
    cooldownUntil: Date | null,
    providerRequestId?: string | null,
    providerStatus?: string | null,
    devOtp?: string
  ) {
    return {
      success: true,
      otpRequestId,
      expiresAt: expiresAt.toISOString(),
      resendAfterSeconds: cooldownUntil ? Math.max(0, this.secondsUntil(cooldownUntil)) : 0,
      providerRequestId: providerRequestId ?? undefined,
      providerStatus: providerStatus ?? undefined,
      devOtp: this.devOtpPayload(devOtp, expiresAt)
    };
  }

  private shouldUseDevPhoneOtpTransport(): boolean {
    return (
      this.config.get<string>("NODE_ENV", "development") !== "production" &&
      this.config.get<boolean>("PHONE_OTP_DEV_TOAST_ENABLED", true)
    );
  }

  private devPhoneOtpForExisting(
    flowId: string,
    phoneNumber: string,
    otpRequestId: string,
    providerStatus?: string | null
  ): string | undefined {
    if (providerStatus !== "DEV_OTP" || !this.shouldUseDevPhoneOtpTransport()) {
      return undefined;
    }
    return this.devPhoneOtpCode(flowId, phoneNumber, otpRequestId);
  }

  private devPhoneOtpCode(flowId: string, phoneNumber: string, otpRequestId: string): string {
    const digest = createHash("sha256")
      .update([
        "dev-phone-otp",
        flowId,
        phoneNumber,
        otpRequestId,
        this.crypto.pepper("OTP_PEPPER")
      ].join(":"))
      .digest();
    return (digest.readUIntBE(0, 6) % 1_000_000).toString().padStart(6, "0");
  }

  private devOtpPayload(code: string | undefined, expiresAt: Date) {
    if (!code || !this.shouldUseDevPhoneOtpTransport()) {
      return undefined;
    }
    return {
      code,
      delivery: "toast" as const,
      expiresAt: expiresAt.toISOString()
    };
  }

  private tooManyOtpAttempts(blockedUntil: Date): HttpException {
    return new HttpException(
      {
        code: "PHONE_OTP_BLOCKED",
        message: "Too many verification attempts. Try again later.",
        retryAfterSeconds: Math.max(0, this.secondsUntil(blockedUntil))
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }

  private providerHttpError(error: unknown): HttpException {
    if (!(error instanceof OtpProviderError)) {
      return new ServiceUnavailableException({
        code: "OTP_PROVIDER_UNAVAILABLE",
        message: "We could not send the verification code. Try again shortly."
      });
    }
    const status = error.code === "OTP_PROVIDER_AUTH_FAILED" ||
      error.code === "OTP_PROVIDER_ACCOUNT_NOT_READY" ||
      error.code === "OTP_PROVIDER_BALANCE_LOW" ||
      error.code === "OTP_PROVIDER_TEMPLATE_INVALID"
      ? HttpStatus.FAILED_DEPENDENCY
      : HttpStatus.SERVICE_UNAVAILABLE;
    return new HttpException({ code: error.code, message: error.message }, status);
  }

  private setCheckoutPhoneProofCookie(response: Response, proof: string) {
    const sameSite = this.config.get<"lax" | "strict" | "none">("COOKIE_SAME_SITE", "lax");
    const domain = this.config.get<string>("COOKIE_DOMAIN");
    const secure = this.config.get<string>("NODE_ENV") === "production" || sameSite === "none";
    response.cookie(this.checkoutPhoneProofCookieName(), proof, {
      httpOnly: true,
      secure,
      sameSite,
      domain: this.checkoutPhoneProofCookieName().startsWith("__Host-") ? undefined : domain,
      path: "/",
      maxAge: this.config.get<number>("CHECKOUT_PHONE_PROOF_TTL_SECONDS", 600) * 1000
    });
  }

  private clearCheckoutPhoneProofCookie(response: Response) {
    const sameSite = this.config.get<"lax" | "strict" | "none">("COOKIE_SAME_SITE", "lax");
    const domain = this.config.get<string>("COOKIE_DOMAIN");
    const secure = this.config.get<string>("NODE_ENV") === "production" || sameSite === "none";
    response.clearCookie(this.checkoutPhoneProofCookieName(), {
      httpOnly: true,
      secure,
      sameSite,
      domain: this.checkoutPhoneProofCookieName().startsWith("__Host-") ? undefined : domain,
      path: "/"
    });
  }

  private recordProofFailure(context: RequestContext, reason: string) {
    this.observability.recordOtpProofFailed(reason);
    this.logger.warn(JSON.stringify({
      event: "otp.proof_failed",
      outcome: "failure",
      reason,
      requestId: context.requestId
    }));
    this.audit.record({
      eventType: "otp.proof_failed",
      outcome: AuditOutcome.FAILURE,
      ip: context.ip,
      requestId: context.requestId,
      metadata: { reason }
    });
  }

  private shadowEmailForPhone(phoneNumber: string): string {
    return `phone_${phoneNumber.replace(/\D/g, "")}@phone.lotzi.local`;
  }

  private normalizeLoginIdentifier(raw: string): LoginIdentifier {
    const value = raw.trim();
    if (!value.includes("@")) {
      try {
        return { kind: "phone", value: this.phones.normalizeIndianMobile(value) };
      } catch {
        return { kind: "email", value: this.normalizeEmail(value) };
      }
    }
    return { kind: "email", value: this.normalizeEmail(value) };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "P2002"
    );
  }

  private uniqueConstraintTargets(error: unknown): string[] {
    if (!this.isUniqueConstraintError(error) || !error || typeof error !== "object") {
      return [];
    }
    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    if (Array.isArray(target)) {
      return target.filter((value): value is string => typeof value === "string");
    }
    return typeof target === "string" ? [target] : [];
  }

  private secondsUntil(date: Date): number {
    return Math.ceil((date.getTime() - Date.now()) / 1000);
  }

  private signupSessionRoleCodes(intent: SignupIntent) {
    return intent.accountType === "MERCHANT" ? [ROLE_CODES.MERCHANT_OWNER] : [ROLE_CODES.CUSTOMER];
  }

  private async verifyGoogleIdentity(idToken: string) {
    let decoded;
    try {
      decoded = await this.firebaseAdmin.auth.verifyIdToken(idToken);
    } catch {
      throw new UnauthorizedException("Invalid Google identity token.");
    }

    const provider = decoded.firebase?.sign_in_provider;
    if (provider !== "google.com" || !decoded.email || !decoded.email_verified) {
      throw new UnauthorizedException("Invalid Google identity token.");
    }
    return {
      providerUserId: decoded.uid,
      email: this.normalizeEmail(decoded.email),
      name: typeof decoded.name === "string" ? decoded.name : null,
      picture: typeof decoded.picture === "string" ? decoded.picture : null
    };
  }

  private async recordFailedLogin(user: User, context: RequestContext) {
    const failedAttempts = user.failedAttempts + 1;
    await this.repository.prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts,
        lockedUntil: failedAttempts >= 5 ? this.minutesFromNow(15) : user.lockedUntil
      }
    });
    this.audit.record({
      eventType: "auth.login.failed_attempt_recorded",
      actor: user.email,
      actorUserId: user.id,
      outcome: AuditOutcome.FAILURE,
      ip: context.ip,
      requestId: context.requestId,
      metadata: { failedAttempts }
    });
  }

  private signupIntentFromDto(dto: SignupDto): SignupIntent {
    const accountType = dto.accountType ?? "CUSTOMER";
    if (accountType === "MERCHANT") {
      const storeName = dto.storeName?.trim().replace(/\s+/g, " ");
      if (!storeName) {
        throw new BadRequestException("Store name is required for merchant signup.");
      }
      return { accountType, storeName };
    }
    return { accountType: "CUSTOMER" };
  }

  private rejectMerchantGoogleIntent(dto: GoogleLoginDto) {
    const rawDto = dto as GoogleLoginDto & { accountType?: unknown; storeName?: unknown };
    if (rawDto.accountType === "MERCHANT" || rawDto.storeName !== undefined) {
      throw new BadRequestException("Merchant accounts must use email signup and password login.");
    }
  }

  private signupIntentFromMetadata(metadata: Prisma.JsonValue): SignupIntent {
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      const record = metadata as Record<string, unknown>;
      if (record.accountType === "MERCHANT") {
        const storeName = typeof record.storeName === "string"
          ? record.storeName.trim().replace(/\s+/g, " ")
          : undefined;
        if (storeName) {
          return { accountType: "MERCHANT", storeName };
        }
      }
    }
    return { accountType: "CUSTOMER" };
  }

  private passwordResetHash(selector: string, verifier: string, nonce: string): string {
    return this.crypto.hmac(
      ["password_reset", selector, verifier, nonce].join(":"),
      this.crypto.pepper("PASSWORD_RESET_PEPPER")
    );
  }

  private passwordResetUrl(token: string): string {
    const frontendUrl = this.config.get<string>("FRONTEND_URL", "http://localhost:3000");
    const encoded = encodeURIComponent(token);
    return this.config.get<boolean>("AUTH_RESET_HASH_LINKS_ENABLED", true)
      ? `${frontendUrl}/auth/reset-password#token=${encoded}`
      : `${frontendUrl}/auth/reset-password?token=${encoded}`;
  }

  private persistentLoginRequested(dto: LoginDto): boolean {
    if (!this.config.get<boolean>("AUTH_REMEMBER_ME_ENABLED", true)) {
      return true;
    }
    return dto.remember !== false;
  }

  private async enforceSignupLimits(email: string, context: RequestContext) {
    await Promise.all([
      this.rateLimit.enforce(`signup:email:${email}`, 3, 60 * 60),
      this.rateLimit.enforce(`signup:device:${context.deviceFingerprint}`, 5, 60 * 60),
      this.rateLimit.enforce(`signup:ip:${context.ip ?? "unknown"}`, 20, 60 * 60)
    ]);
  }

  private async enforceLoginLimits(email: string, context: RequestContext) {
    await Promise.all([
      this.rateLimit.enforce(`login:email:${email}`, 5, 15 * 60),
      this.rateLimit.enforce(`login:device:${context.deviceFingerprint}`, 20, 15 * 60),
      this.rateLimit.enforce(`login:ip:${context.ip ?? "unknown"}`, 50, 15 * 60)
    ]);
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private sanitizeName(name: string): string {
    return name.trim().replace(/\s+/g, " ");
  }

  private minutesFromNow(minutes: number): Date {
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  private secondsFromNow(seconds: number): Date {
    return new Date(Date.now() + seconds * 1000);
  }

  private daysFromNow(days: number): Date {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }
}
