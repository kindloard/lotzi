import { RedisService } from "../../modules/redis/redis.service";

describe("RedisService local fallback cache", () => {
  it("serves setEx values locally when Redis is not configured and clears them on del", async () => {
    const redis = new RedisService({ get: jest.fn(() => undefined) } as never);

    await redis.setEx("session:session-1", 60, "cached-session");

    await expect(redis.get("session:session-1")).resolves.toBe("cached-session");

    await redis.del("session:session-1");

    await expect(redis.get("session:session-1")).resolves.toBeNull();
  });
});
