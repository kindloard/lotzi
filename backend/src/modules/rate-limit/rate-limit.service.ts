import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";

interface LimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  degraded: boolean;
}

interface RateLimitOptions {
  degradedLimit?: number;
}

interface MemoryBucket {
  count: number;
  resetAt: number;
}

const GCRA_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local burst = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local tat = tonumber(redis.call("GET", key) or "0")
if tat < now then
  tat = now
end
local new_tat = tat + interval
local allow_at = new_tat - burst
if allow_at <= now then
  redis.call("SET", key, new_tat, "PX", ttl)
  return {1, 0}
end
return {0, math.ceil((allow_at - now) / 1000)}
`;

const REDIS_CIRCUIT_OPEN_MS = 30_000;

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly memory = new Map<string, MemoryBucket>();
  private redisCircuitOpenUntil = 0;
  private lastRedisErrorLogAt = 0;

  constructor(private readonly redis: RedisService) {}

  async consume(key: string, limit: number, windowSeconds: number, options: RateLimitOptions = {}): Promise<LimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const intervalMs = Math.ceil(windowMs / limit);

    if (this.redis.isConfigured && now >= this.redisCircuitOpenUntil) {
      try {
        const result = (await this.redis.eval(GCRA_SCRIPT, [key], [
          now,
          intervalMs,
          windowMs,
          windowMs + intervalMs
        ])) as [number, number];
        return {
          allowed: Number(result[0]) === 1,
          retryAfterSeconds: Number(result[1]),
          degraded: false
        };
      } catch (error) {
        this.redisCircuitOpenUntil = now + REDIS_CIRCUIT_OPEN_MS;
        if (now - this.lastRedisErrorLogAt >= REDIS_CIRCUIT_OPEN_MS) {
          this.lastRedisErrorLogAt = now;
          const msg = `Redis rate limiter unavailable; using emergency local throttle for ${Math.ceil(REDIS_CIRCUIT_OPEN_MS / 1000)}s. ${error instanceof Error ? error.message : String(error)}`;
          if (process.env.NODE_ENV !== "production") {
            this.logger.debug(msg);
          } else {
            this.logger.warn(msg);
          }
        }
      }
    }

    return this.consumeInMemory(key, options.degradedLimit ?? Math.max(limit * 3, limit), windowMs);
  }

  async enforce(key: string, limit: number, windowSeconds: number): Promise<void> {
    const result = await this.consume(key, limit, windowSeconds);
    if (result.allowed) {
      return;
    }
    throw new HttpException(
      {
        message: "Too many requests. Please retry later.",
        retryAfterSeconds: result.retryAfterSeconds
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }

  private consumeInMemory(key: string, limit: number, windowMs: number): LimitResult {
    const now = Date.now();
    const existing = this.memory.get(key);
    if (!existing || existing.resetAt <= now) {
      this.memory.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: 0, degraded: true };
    }

    existing.count += 1;
    if (existing.count <= limit) {
      return { allowed: true, retryAfterSeconds: 0, degraded: true };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
      degraded: true
    };
  }
}
