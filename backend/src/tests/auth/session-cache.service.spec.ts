import { UserStatus } from "@prisma/client";
import { SessionCacheService } from "../../modules/auth/session-cache.service";

const cachedSession = {
  id: "session-1",
  userId: "user-1",
  tokenFamilyId: "family-1",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  user: {
    id: "user-1",
    email: "owner@example.com",
    fullName: null,
    avatarUrl: null,
    status: UserStatus.ACTIVE,
    emailVerified: true,
    authzVersion: 1
  }
};

describe("SessionCacheService", () => {
  it("returns null instead of throwing when Redis reads fail", async () => {
    const service = new SessionCacheService({
      get: jest.fn(async () => {
        throw new Error("redis down");
      }),
      setEx: jest.fn(),
      del: jest.fn()
    } as never);

    await expect(service.get("session-1")).resolves.toBeNull();
  });

  it("uses session-scoped keys for writes and invalidation", async () => {
    const redis = {
      get: jest.fn(),
      setEx: jest.fn(async () => undefined),
      del: jest.fn(async () => undefined)
    };
    const service = new SessionCacheService(redis as never);

    await service.set(cachedSession);
    await service.invalidate("session-1");

    expect(redis.setEx).toHaveBeenCalledWith("session:session-1", expect.any(Number), JSON.stringify(cachedSession));
    expect(redis.del).toHaveBeenCalledWith("session:session-1");
  });
});
