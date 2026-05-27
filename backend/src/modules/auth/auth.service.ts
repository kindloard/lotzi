import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AuditOutcome,
  IdentityProviderName,
  OtpPurpose,
  Prisma,
  SessionRevokedReason,
  User,
  UserProviderType,
  UserStatus
} from "@prisma/client";
import { Response } from "express";
import { randomUUID } from "node:crypto";
import { FirebaseAdminService } from "../../integrations/firebase/firebase-admin.service";
import { CryptoService } from "../../security/crypto.service";
import { OtpService } from "../../security/otp.service";
import { PasswordService } from "../../security/password.service";
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
  LoginDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  RejectedRedirectDto,
  ResendOtpDto,
  SignupDto,
  VerifySignupOtpDto
} from "./dto/auth.dto";
import { SessionRepository } from "./repositories/session.repository";
import { SessionCacheService } from "./session-cache.service";
import { SessionService } from "./session.service";

type SignupAccountType = "CUSTOMER" | "MERCHANT";

interface SignupIntent {
  accountType: SignupAccountType;
  storeName?: string;
}

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
    private readonly crypto: CryptoService,
    private readonly tokens: TokenService,
    private readonly rateLimit: RateLimitService,
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
              return { user: userResult.user, otpId: "", sent: false, cooldownUntil: undefined };
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

  async login(dto: LoginDto, context: RequestContext, response: Response) {
    const timer = this.performance.start("login", response);
    const email = this.normalizeEmail(dto.email);
    let actorUserId: string | undefined;
    try {
      await timer.time("rate_limit", () => this.enforceLoginLimits(email, context));

      const user = await timer.time("user_lookup", () => this.users.findByEmail(email));
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
          actor: email,
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
        actor: email,
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
      timer.end({ email, actorUserId });
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
    try {
      if (!refreshToken) {
        this.observability.recordAuthRefreshInvalid("missing");
        throw authUnauthorized(AUTH_REFRESH_MISSING, "Missing refresh token.");
      }

      const parsed = this.tokens.parseRefreshToken(refreshToken);
      const oldHash = this.tokens.hashRefreshToken(refreshToken);
      const session = await this.sessions.findByRefreshHash(oldHash);
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

      await this.rateLimit.enforce(`refresh:session:${session.id}`, 30, 60);
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
      const rotated = await this.sessions.rotateRefreshToken({
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
      });

      const [access, routeState] = await Promise.all([
        this.tokens.issueAccessToken({
          userId: rotated.user.id,
          sessionId: rotated.id,
          tokenFamilyId: rotated.tokenFamilyId,
          authzVersion: rotated.user.authzVersion
        }),
        this.authState.getCachedOrLoadRouteState(rotated.user.id, rotated.user.authzVersion)
      ]);
      this.tokens.setAuthCookies(response, access.token, nextRefresh.token, rotated.id, access.expiresAt, {
        persistent: rotated.persistent ?? true,
        clientSecret: binding.secret
      });
      await this.primeAuthCaches(rotated, routeState);
      return this.sessionPayloadFromRouteState(routeState, access.expiresAt, rotated.id);
    } finally {
      this.observability.observeAuthRefreshLatency(Date.now() - started);
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
