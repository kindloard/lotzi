import { Injectable, Logger } from "@nestjs/common";
import { UserStatus } from "@prisma/client";
import { RedisService } from "../redis/redis.service";

const SESSION_CACHE_TTL_SECONDS = 60;
const CACHE_ERROR_LOG_INTERVAL_MS = 60_000;

export interface CachedSessionPrincipal {
  id: string;
  userId: string;
  tokenFamilyId: string;
  expiresAt: string;
  user: {
    id: string;
    email: string;
    fullName: string | null;
    avatarUrl: string | null;
    status: UserStatus;
    emailVerified: boolean;
    authzVersion: number;
  };
}

@Injectable()
export class SessionCacheService {
  private readonly logger = new Logger(SessionCacheService.name);
  private lastErrorLogAt = 0;

  constructor(private readonly redis: RedisService) {}

  async get(sessionId: string): Promise<CachedSessionPrincipal | null> {
    try {
      const cached = await this.redis.get(this.key(sessionId));
      if (!cached) {
        return null;
      }
      return this.parse(cached);
    } catch (error) {
      this.logCacheError("read", error);
      return null;
    }
  }

  async set(principal: CachedSessionPrincipal): Promise<void> {
    const ttl = this.ttlSeconds(principal.expiresAt);
    if (ttl <= 0) {
      return;
    }

    try {
      await this.redis.setEx(this.key(principal.id), ttl, JSON.stringify(principal));
    } catch (error) {
      this.logCacheError("write", error);
    }
  }

  async invalidate(sessionId: string): Promise<void> {
    try {
      await this.redis.del(this.key(sessionId));
    } catch (error) {
      this.logCacheError("delete", error);
    }
  }

  async invalidateMany(sessionIds: Iterable<string>): Promise<void> {
    await Promise.all(Array.from(new Set(sessionIds)).map((sessionId) => this.invalidate(sessionId)));
  }

  private key(sessionId: string) {
    return `session:${sessionId}`;
  }

  private ttlSeconds(expiresAt: string) {
    const secondsUntilExpiry = Math.floor((Date.parse(expiresAt) - Date.now()) / 1000);
    return Math.min(SESSION_CACHE_TTL_SECONDS, secondsUntilExpiry);
  }

  private parse(value: string): CachedSessionPrincipal | null {
    try {
      const parsed = JSON.parse(value) as Partial<CachedSessionPrincipal>;
      if (
        !parsed ||
        typeof parsed.id !== "string" ||
        typeof parsed.userId !== "string" ||
        typeof parsed.tokenFamilyId !== "string" ||
        typeof parsed.expiresAt !== "string" ||
        !parsed.user ||
        typeof parsed.user.id !== "string" ||
        typeof parsed.user.email !== "string" ||
        typeof parsed.user.authzVersion !== "number"
      ) {
        return null;
      }
      return parsed as CachedSessionPrincipal;
    } catch {
      return null;
    }
  }

  private logCacheError(action: string, error: unknown) {
    const now = Date.now();
    if (now - this.lastErrorLogAt <= CACHE_ERROR_LOG_INTERVAL_MS) {
      return;
    }
    this.lastErrorLogAt = now;
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(`Session cache ${action} failed; falling back to DB: ${message}`);
  }
}
