import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { UserProviderType, UserStatus } from "@prisma/client";
import { CustomerAccountService } from "../../modules/customer-account/customer-account.service";
import type { AuthenticatedPrincipal, RequestContext } from "../../modules/auth/auth.types";

const auth: AuthenticatedPrincipal = {
  userId: "user-1",
  sessionId: "session-current",
  tokenFamilyId: "family-1",
  authzVersion: 7,
  roleCodes: ["CUSTOMER"],
  permissions: ["profile:read", "profile:write"],
  isPlatformAdmin: false,
  user: {
    id: "user-1",
    email: "buyer@example.com",
    fullName: "Buyer One",
    avatarUrl: null,
    status: UserStatus.ACTIVE,
    emailVerified: true,
    authzVersion: 7
  }
};

const context: RequestContext = {
  requestId: "req-1",
  ip: "127.0.0.1",
  userAgent: "jest",
  deviceFingerprint: "device-1",
  deviceMetadata: {}
};

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "buyer@example.com",
    fullName: "Buyer One",
    avatarUrl: "https://cdn.example/avatar.webp",
    phone: "+919876543210",
    emailVerified: true,
    providerType: UserProviderType.EMAIL,
    status: UserStatus.ACTIVE,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    customerProfile: {
      displayName: "Buyer One",
      phone: "+919876543210",
      marketingOptIn: true,
      loyaltyTier: "GOLD"
    },
    passwordHash: "must-not-leak",
    authzVersion: 99,
    failedAttempts: 4,
    ...overrides
  };
}

function serviceWith(prisma: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const rateLimit = { enforce: jest.fn() };
  const password = {
    hash: jest.fn(async () => "new-hash"),
    verify: jest.fn(async () => true)
  };
  const tokens = { clearAuthCookies: jest.fn() };
  const audit = { record: jest.fn() };
  const authStateInvalidator = {
    invalidateSessions: jest.fn(),
    invalidateUserVersions: jest.fn()
  };
  const service = new CustomerAccountService(
    prisma as never,
    rateLimit as never,
    password as never,
    {
      generate: jest.fn(() => "123456"),
      nonce: jest.fn(() => "nonce"),
      hash: jest.fn(() => "otp-hash")
    } as never,
    {
      hmac: jest.fn(() => "confirmation-hash"),
      pepper: jest.fn(() => "pepper"),
      timingSafeEqual: jest.fn((left: string, right: string) => left === right)
    } as never,
    tokens as never,
    {
      sendEmailChangeOtp: jest.fn(),
      sendAccountDeletionOtp: jest.fn(),
      sendPasswordChangedNotice: jest.fn()
    } as never,
    audit as never,
    authStateInvalidator as never,
    {
      uploadOriginalImage: jest.fn(),
      transformedUrl: jest.fn()
    } as never
  );
  return {
    service,
    rateLimit,
    password,
    tokens,
    audit,
    authStateInvalidator,
    ...overrides
  };
}

describe("CustomerAccountService safety contracts", () => {
  it("returns an explicit safe profile shape", async () => {
    const { service } = serviceWith({
      user: {
        findUniqueOrThrow: jest.fn(async () => profileRow())
      }
    });

    const result = await service.profile(auth);

    expect(Object.keys(result.profile).sort()).toEqual([
      "avatarUrl",
      "createdAt",
      "email",
      "emailVerified",
      "fullName",
      "id",
      "loyaltyTier",
      "marketingOptIn",
      "phone",
      "profileVersion",
      "providerType",
      "updatedAt"
    ].sort());
    expect(result.profile).toMatchObject({
      id: "user-1",
      email: "buyer@example.com",
      fullName: "Buyer One",
      phone: "+919876543210",
      marketingOptIn: true,
      loyaltyTier: "GOLD"
    });
    expect(result.profile).not.toHaveProperty("passwordHash");
    expect(result.profile).not.toHaveProperty("authzVersion");
    expect(result.profile).not.toHaveProperty("failedAttempts");
  });

  it("redacts raw session security metadata from the session list", async () => {
    const { service } = serviceWith({
      session: {
        findMany: jest.fn(async () => [
          {
            id: "session-current",
            userAgent:
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36",
            deviceMetadata: {
              ipAddress: "203.0.113.55",
              tokenFamilyId: "refresh-family-secret",
              timezone: "Asia/Calcutta",
              acceptLanguage: "en-IN"
            },
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            lastSeenAt: new Date("2026-01-02T00:00:00.000Z"),
            expiresAt: new Date("2026-02-01T00:00:00.000Z")
          }
        ])
      }
    });

    const result = await service.sessions(auth);
    const safe = result.sessions[0];

    expect(safe).toMatchObject({
      id: "session-current",
      browser: "Chrome",
      os: "Windows",
      timezone: "Asia/Calcutta",
      language: "en-IN",
      current: true
    });
    expect(JSON.stringify(safe)).not.toContain("203.0.113.55");
    expect(JSON.stringify(safe)).not.toContain("refresh-family-secret");
    expect(JSON.stringify(safe)).not.toContain("Mozilla/5.0");
  });

  it("returns a 409 with the latest safe profile for stale profile writes", async () => {
    const { service } = serviceWith({
      user: {
        findUniqueOrThrow: jest.fn(async () => profileRow())
      }
    });

    try {
      await service.updateProfile(
        auth,
        { profileVersion: "2026-01-01T00:00:00.000Z", fullName: "New Buyer" },
        context
      );
      throw new Error("Expected updateProfile to reject stale writes.");
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      const response = (error as ConflictException).getResponse();
      expect(response).toMatchObject({
        code: "PROFILE_VERSION_CONFLICT",
        details: {
          profile: {
            id: "user-1",
            email: "buyer@example.com",
            profileVersion: "2026-01-02T00:00:00.000Z"
          }
        }
      });
      expect(JSON.stringify(response)).not.toContain("must-not-leak");
    }
  });

  it("requires an active delete request before accepting delete confirmation", async () => {
    const { service, password } = serviceWith({
      user: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: "user-1",
          email: "buyer@example.com",
          passwordHash: "hash",
          authzVersion: 7
        }))
      },
      accountDeletionRequest: {
        findFirst: jest.fn(async () => null)
      }
    });

    await expect(
      service.deleteAccount(auth, { currentPassword: "correct-password" }, context, {} as never)
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(password.verify).not.toHaveBeenCalled();
  });
});
