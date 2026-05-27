import { Injectable } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";

@Injectable()
export class AuthStateInvalidator {
  constructor(private readonly redis: RedisService) {}

  async invalidateUserVersions(userId: string, authzVersions: Iterable<number>): Promise<void> {
    const versions = Array.from(new Set(authzVersions)).filter((version) => Number.isFinite(version));
    await Promise.all(
      versions.flatMap((version) => [
        this.redis.del(`authz:${userId}:${version}:platform`),
        this.redis.del(`route-state:${userId}:${version}`)
      ])
    );
  }

  async invalidateSessions(sessionIds: Iterable<string>): Promise<void> {
    await Promise.all(
      Array.from(new Set(sessionIds)).map((sessionId) => this.redis.del(`session:${sessionId}`))
    );
  }
}
