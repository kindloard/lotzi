import { ConfigService } from "@nestjs/config";
import { AuditOutcome, SessionRevokedReason, UserStatus } from "@prisma/client";
import { Response } from "express";
import { CryptoService } from "../../security/crypto.service";
import { AuthService } from "../../modules/auth/auth.service";

const routeState = {
  user: {
    id: "user-1",
    email: "buyer@example.com",
    fullName: "Buyer",
    avatarUrl: null,
    status: UserStatus.ACTIVE,
    emailVerified: true,
    authzVersion: 2
  },
  roleCodes: ["CUSTOMER"],
  merchantStoreId: null,
  merchantStoreStatus: null,
  onboardingState: null,
  onboardingComplete: false,
  redirectTo: "/"
};

function serviceWith(overrides: {
  repository?: Record<string, unknown>;
  password?: Record<string, unknown>;
  tokens?: Record<string, unknown>;
  mail?: Record<string, unknown>;
  audit?: Record<string, unknown>;
  config?: Record<string, unknown>;
  sessions?: Record<string, unknown>;
}) {
  const config = new ConfigService({
    FRONTEND_URL: "http://localhost:3000",
    AUTH_RESET_HASH_LINKS_ENABLED: true,
    AUTH_REMEMBER_ME_ENABLED: true,
    REFRESH_TOKEN_TTL_DAYS: 30,
    PASSWORD_RESET_PEPPER: "test-reset-pepper-minimum-32-characters",
    DEVICE_FINGERPRINT_PEPPER: "test-device-pepper-minimum-32-characters",
    ...overrides.config
  });
  const crypto = new CryptoService(config);
  const repository = {
    prisma: {},
    ...overrides.repository
  };
  const sessions = {
    findByRefreshHash: jest.fn(async () => null),
    findConsumedRefresh: jest.fn(async () => null),
    findActiveById: jest.fn(async () => null),
    revokeTokenFamily: jest.fn(),
    markConsumedRefreshReuse: jest.fn(),
    rotateRefreshToken: jest.fn(),
    listActiveForUser: jest.fn(),
    listActiveIdsForTokenFamily: jest.fn(async () => []),
    listActiveIdsForUser: jest.fn(async () => []),
    revokeSession: jest.fn(),
    ...overrides.sessions
  };
  const sessionCache = {
    set: jest.fn(),
    invalidate: jest.fn(),
    invalidateMany: jest.fn()
  };
  const authState = {
    getRouteState: jest.fn(async () => routeState),
    getCachedOrLoadRouteState: jest.fn(async () => routeState),
    cacheRouteState: jest.fn()
  };
  const authStateInvalidator = {
    invalidateUserVersions: jest.fn(),
    invalidateSessions: jest.fn()
  };
  const performance = {
    start: jest.fn(() => ({
      time: jest.fn((_step: string, callback: () => Promise<unknown>) => callback()),
      record: jest.fn(),
      end: jest.fn()
    }))
  };
  return {
    service: new AuthService(
      repository as never,
      authState as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      sessions as never,
      {} as never,
      {
        hash: jest.fn(async () => "new-password-hash"),
        verify: jest.fn(async () => true),
        ...overrides.password
      } as never,
      {} as never,
      crypto,
      {
        hashRefreshToken: jest.fn((token: string) => `hash:${token}`),
        newRefreshToken: jest.fn(() => "new-refresh"),
        issueRefreshToken: jest.fn(() => ({
          token: "v2.next.old-refresh.secret",
          jti: "next",
          parentJti: "old-refresh",
          secret: "secret"
        })),
        parseRefreshToken: jest.fn(() => ({ version: "legacy" })),
        newClientSecret: jest.fn(() => "client-secret"),
        hashClientSecret: jest.fn((secret: string) => `client:${secret}`),
        issueAccessToken: jest.fn(async () => ({
          token: "access",
          expiresAt: new Date(Date.now() + 900_000),
          jti: "jti"
        })),
        setAuthCookies: jest.fn(),
        clearAuthCookies: jest.fn(),
        ...overrides.tokens
      } as never,
      { enforce: jest.fn() } as never,
      {
        sendPasswordChangedNotice: jest.fn(),
        ...overrides.mail
      } as never,
      { record: jest.fn(), ...overrides.audit } as never,
      {} as never,
      authStateInvalidator as never,
      { platformAuthorization: jest.fn(async () => ({ roleCodes: [], permissions: [], isPlatformAdmin: false })) } as never,
      performance as never,
      config,
      sessionCache as never,
      {
        recordAuthRefreshInvalid: jest.fn(),
        recordAuthRefreshRace: jest.fn(),
        observeAuthRefreshLatency: jest.fn(),
        refreshReuse: { inc: jest.fn() }
      } as never
    ),
    crypto,
    repository,
    sessions,
    sessionCache,
    authState,
    authStateInvalidator
  };
}

describe("AuthService critical security flows", () => {
  const context = {
    requestId: "req-1",
    ip: "127.0.0.1",
    userAgent: "jest",
    deviceFingerprint: "device",
    deviceMetadata: {}
  };

  it("revokes an entire token family when a consumed refresh token is reused", async () => {
    const revokeTokenFamily = jest.fn();
    const { service, sessions } = serviceWith({
      repository: { prisma: {} }
    });
    (sessions.findConsumedRefresh as jest.Mock).mockResolvedValue({
      id: "history-1",
      userId: "user-1",
      sessionId: "session-1",
      tokenFamilyId: "family-1"
    });
    sessions.revokeTokenFamily = revokeTokenFamily;

    await expect(service.refresh("old-refresh", undefined, context, {} as Response)).rejects.toThrow();

    expect(revokeTokenFamily).toHaveBeenCalledWith(
      "family-1",
      SessionRevokedReason.TOKEN_REUSE
    );
    expect(sessions.markConsumedRefreshReuse).toHaveBeenCalledWith("history-1");
  });

  it("returns a refresh race without revoking the family for direct-parent same-device replay", async () => {
    const clearAuthCookies = jest.fn();
    const { service, sessions } = serviceWith({
      tokens: {
        parseRefreshToken: jest.fn(() => ({ version: "v2", jti: "old-jti", parentJti: "root" })),
        clearAuthCookies
      },
      sessions: {
        findConsumedRefresh: jest.fn(async () => ({
          id: "history-1",
          userId: "user-1",
          sessionId: "session-1",
          tokenFamilyId: "family-1",
          refreshTokenJti: "old-jti",
          replacementRefreshTokenJti: "new-jti",
          deviceFingerprint: "device"
        })),
        findActiveById: jest.fn(async () => ({
          id: "session-1",
          tokenFamilyId: "family-1",
          revoked: false,
          expiresAt: new Date(Date.now() + 60_000),
          refreshTokenJti: "new-jti",
          refreshTokenParentJti: "old-jti",
          refreshTokenIssuedAt: new Date(),
          clientSecretHash: "client:bound",
          deviceFingerprint: "device"
        }))
      }
    });

    await expect(
      service.refresh("v2.old-jti.root.secret", "bound", context, {} as Response)
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "AUTH_REFRESH_RACE" }),
      status: 409
    });

    expect(sessions.revokeTokenFamily).not.toHaveBeenCalled();
    expect(clearAuthCookies).not.toHaveBeenCalled();
  });

  it("revokes the family when a consumed refresh replay is outside the race window", async () => {
    const { service, sessions } = serviceWith({
      tokens: {
        parseRefreshToken: jest.fn(() => ({ version: "v2", jti: "old-jti", parentJti: "root" }))
      },
      sessions: {
        findConsumedRefresh: jest.fn(async () => ({
          id: "history-1",
          userId: "user-1",
          sessionId: "session-1",
          tokenFamilyId: "family-1",
          refreshTokenJti: "old-jti",
          replacementRefreshTokenJti: "new-jti",
          deviceFingerprint: "device"
        })),
        findActiveById: jest.fn(async () => ({
          id: "session-1",
          tokenFamilyId: "family-1",
          revoked: false,
          expiresAt: new Date(Date.now() + 60_000),
          refreshTokenJti: "new-jti",
          refreshTokenParentJti: "old-jti",
          refreshTokenIssuedAt: new Date(Date.now() - 11_000),
          clientSecretHash: "client:bound",
          deviceFingerprint: "device"
        }))
      }
    });

    await expect(
      service.refresh("v2.old-jti.root.secret", "bound", context, {} as Response)
    ).rejects.toThrow();

    expect(sessions.revokeTokenFamily).toHaveBeenCalledWith(
      "family-1",
      SessionRevokedReason.TOKEN_REUSE
    );
  });

  it("rejects merchant onboarding through Google login", async () => {
    const { service } = serviceWith({});

    await expect(
      service.googleLogin(
        {
          idToken: "valid-length-token-value",
          accountType: "MERCHANT",
          storeName: "Fresh Mart"
        } as never,
        context,
        {} as Response
      )
    ).rejects.toThrow("Merchant accounts must use email signup and password login.");
  });

  it("marks merchant OTP sessions with the merchant owner role for onboarding redirect", () => {
    const { service } = serviceWith({});

    const roleCodes = (
      service as unknown as {
        signupSessionRoleCodes(intent: { accountType: "CUSTOMER" | "MERCHANT"; storeName?: string }): string[];
      }
    ).signupSessionRoleCodes({ accountType: "MERCHANT", storeName: "Fresh Mart" });

    expect(roleCodes).toEqual(["MERCHANT_OWNER"]);
  });

  it("rejects missing signup OTP without starting the verification transaction", async () => {
    const transaction = jest.fn();
    const passwordVerify = jest.fn(async () => false);
    const { service } = serviceWith({
      repository: {
        findLatestSignupOtp: jest.fn(async () => null),
        prisma: {
          $transaction: transaction
        }
      },
      password: {
        verify: passwordVerify
      }
    });

    await expect(
      service.verifySignupOtp(
        { email: "buyer@example.com", otp: "123456" },
        context,
        {} as Response
      )
    ).rejects.toThrow("Invalid or expired verification code.");

    expect(passwordVerify).toHaveBeenCalledWith("123456", null);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("builds the session response from the guard principal without another user read", async () => {
    const { service } = serviceWith({});

    await expect(
      service.session(
        {
          userId: "user-1",
          sessionId: "session-1",
          tokenFamilyId: "family-1",
          roleCodes: ["CUSTOMER"],
          permissions: [],
          isPlatformAdmin: false,
          authzVersion: 2,
          user: {
            id: "user-1",
            email: "buyer@example.com",
            fullName: "Buyer",
            avatarUrl: null,
            status: UserStatus.ACTIVE,
            emailVerified: true,
            authzVersion: 2
          },
          routeState
        },
        {} as Response
      )
    ).resolves.toMatchObject({
      sessionId: "session-1",
      user: {
        id: "user-1",
        email: "buyer@example.com",
        roleCodes: ["CUSTOMER"]
      }
    });
  });

  it("revokes all sessions when password reset succeeds", async () => {
    const selector = "selector";
    const verifier = "verifier";
    const nonce = "nonce";
    const config = new ConfigService({
      PASSWORD_RESET_PEPPER: "test-reset-pepper-minimum-32-characters"
    });
    const crypto = new CryptoService(config);
    const verifierHash = crypto.hmac(
      ["password_reset", selector, verifier, nonce].join(":"),
      "test-reset-pepper-minimum-32-characters"
    );
    const sessionUpdateMany = jest.fn();
    const mailNotice = jest.fn();
    const { service } = serviceWith({
      repository: {
        prisma: {
          passwordReset: {
            findUnique: jest.fn(async () => ({
              id: "reset-1",
              userId: "user-1",
              selector,
              verifierHash,
              verifierNonce: nonce,
              consumedAt: null,
              expiresAt: new Date(Date.now() + 60_000),
                user: {
                  id: "user-1",
                  email: "admin@example.com",
                  status: UserStatus.ACTIVE
                }
            }))
          },
          $transaction: jest.fn(async (callback: (tx: unknown) => Promise<void>) =>
            callback({
              user: { update: jest.fn() },
              passwordReset: { update: jest.fn() },
              session: { updateMany: sessionUpdateMany }
            })
          )
        }
      },
      mail: {
        sendPasswordChangedNotice: mailNotice
      }
    });

    await expect(
      service.confirmPasswordReset(
        { token: `${selector}.${verifier}`, newPassword: "new-password-123" },
        context
      )
    ).resolves.toEqual({ status: "PASSWORD_RESET" });

    expect(sessionUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revoked: false },
      data: {
        revoked: true,
        revokedAt: expect.any(Date),
        revokedReason: SessionRevokedReason.PASSWORD_RESET
      }
    });
    expect(mailNotice).toHaveBeenCalledWith("admin@example.com");
  });

  it("generates hash reset links when the rollout flag is enabled", () => {
    const { service } = serviceWith({});
    const resetUrl = (
      service as unknown as { passwordResetUrl(token: string): string }
    ).passwordResetUrl("selector.verifier");

    expect(resetUrl).toBe("http://localhost:3000/auth/reset-password#token=selector.verifier");
  });

  it("can fall back to legacy query reset links through the rollout flag", () => {
    const { service } = serviceWith({
      config: { AUTH_RESET_HASH_LINKS_ENABLED: false }
    });
    const resetUrl = (
      service as unknown as { passwordResetUrl(token: string): string }
    ).passwordResetUrl("selector.verifier");

    expect(resetUrl).toBe("http://localhost:3000/auth/reset-password?token=selector.verifier");
  });

  it("records rejected redirect attempts for audit visibility", () => {
    const auditRecord = jest.fn();
    const { service } = serviceWith({
      audit: { record: auditRecord }
    });

    expect(
      service.recordRejectedRedirect(
        { value: "https://evil.example", reason: "external-origin", sessionId: "session-1" },
        context
      )
    ).toEqual({ status: "RECORDED" });

    expect(auditRecord).toHaveBeenCalledWith({
      eventType: "auth.redirect.rejected",
      outcome: AuditOutcome.DENIED,
      ip: "127.0.0.1",
      requestId: "req-1",
      sessionId: "session-1",
      metadata: {
        value: "https://evil.example",
        reason: "external-origin"
      }
    });
  });
});
