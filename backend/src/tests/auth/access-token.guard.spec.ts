import { UnauthorizedException } from "@nestjs/common";
import { UserStatus } from "@prisma/client";
import { AccessTokenGuard } from "../../modules/auth/guards/access-token.guard";

const token = {
  userId: "user-1",
  sessionId: "session-1",
  tokenFamilyId: "family-1",
  authzVersion: 3,
  jti: "jti-1"
};

const user = {
  id: "user-1",
  email: "owner@example.com",
  fullName: "Owner",
  avatarUrl: null,
  status: UserStatus.ACTIVE,
  emailVerified: true,
  authzVersion: 3
};

function contextWithBearer(request: Record<string, unknown> = {}) {
  const req: {
    header: jest.Mock;
    cookies: Record<string, string>;
    auth?: unknown;
  } = {
    header: jest.fn((name: string) => (name.toLowerCase() === "authorization" ? "Bearer access-token" : undefined)),
    cookies: {},
    ...request
  };
  return {
    request: req,
    context: {
      switchToHttp: () => ({
        getRequest: () => req
      })
    } as never
  };
}

function guardWith(overrides: {
  prismaSession?: unknown;
  cacheGet?: unknown;
  cacheSet?: unknown;
} = {}) {
  const tokens = {
    verifyAccessToken: jest.fn(async () => token),
    accessCookieName: jest.fn(() => "lotzi_access")
  };
  const prisma = {
    session: {
      findUnique: jest.fn(async () => overrides.prismaSession ?? {
        id: "session-1",
        userId: "user-1",
        tokenFamilyId: "family-1",
        revoked: false,
        expiresAt: new Date(Date.now() + 60_000),
        user
      })
    }
  };
  const rbac = {
    platformAuthorization: jest.fn(async () => ({
      roleCodes: ["MERCHANT_OWNER"],
      permissions: ["merchant:onboarding"],
      isPlatformAdmin: false
    }))
  };
  const sessionCache = {
    get: jest.fn(async () => overrides.cacheGet ?? null),
    set: jest.fn(async () => overrides.cacheSet)
  };
  const observability = {
    recordAuthAccessMissing: jest.fn(),
    recordAuthAccessInvalid: jest.fn(),
    recordAuthSessionValidated: jest.fn()
  };

  return {
    guard: new AccessTokenGuard(
      tokens as never,
      prisma as never,
      rbac as never,
      sessionCache as never,
      observability as never
    ),
    tokens,
    prisma,
    rbac,
    sessionCache,
    observability
  };
}

describe("AccessTokenGuard", () => {
  it("uses a valid session cache hit without querying the database", async () => {
    const cached = {
      id: "session-1",
      userId: "user-1",
      tokenFamilyId: "family-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user
    };
    const { guard, prisma } = guardWith({ cacheGet: cached });
    const { context, request } = contextWithBearer();

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(prisma.session.findUnique).not.toHaveBeenCalled();
    expect(request.auth).toMatchObject({
      userId: "user-1",
      sessionId: "session-1",
      roleCodes: ["MERCHANT_OWNER"]
    });
  });

  it("falls back to DB and stores a validated session on cache miss", async () => {
    const { guard, prisma, sessionCache } = guardWith();
    const { context, request } = contextWithBearer();

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(prisma.session.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "session-1" } }));
    expect(sessionCache.set).toHaveBeenCalledWith(expect.objectContaining({ id: "session-1", userId: "user-1" }));
    expect(request.auth).toMatchObject({ authzVersion: 3 });
  });

  it("rejects stale cached authorization versions", async () => {
    const cached = {
      id: "session-1",
      userId: "user-1",
      tokenFamilyId: "family-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: { ...user, authzVersion: 4 }
    };
    const { guard } = guardWith({ cacheGet: cached });
    const { context } = contextWithBearer();

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("rejects revoked DB sessions", async () => {
    const { guard } = guardWith({
      prismaSession: {
        id: "session-1",
        userId: "user-1",
        tokenFamilyId: "family-1",
        revoked: true,
        expiresAt: new Date(Date.now() + 60_000),
        user
      }
    });
    const { context } = contextWithBearer();

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
