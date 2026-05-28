import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

const REDIS_CIRCUIT_OPEN_MS = 30_000;
const LOCAL_CACHE_MAX_KEYS = 2_000;

interface LocalCacheEntry {
  value: string;
  expiresAt: number;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client?: Redis;
  private readonly localCache = new Map<string, LocalCacheEntry>();
  private lastErrorLogAt = 0;
  private circuitOpenUntil = 0;

  constructor(config: ConfigService) {
    const url = config.get<string>("REDIS_URL");
    if (!url) {
      this.logger.warn("REDIS_URL is not configured. Auth rate limits use emergency in-process fallback.");
      return;
    }

    this.client = new Redis(url, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
      commandTimeout: 200,
      connectTimeout: 200,
      retryStrategy: (attempt) => Math.min(attempt * 500, 5_000)
    });

    this.client.on("error", (error) => {
      const now = Date.now();
      if (now - this.lastErrorLogAt > 60_000) {
        this.lastErrorLogAt = now;
        this.logger.error(`Redis error: ${error.message}`);
      }
    });
  }

  get isConfigured(): boolean {
    return Boolean(this.client);
  }

  async eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown> {
    if (!this.client || this.isCircuitOpen()) {
      throw new Error("Redis is not configured.");
    }
    try {
      await this.ensureConnected();
      return await this.client.eval(script, keys.length, ...keys, ...args.map(String));
    } catch (error) {
      this.openCircuit(error);
      throw error;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client || this.isCircuitOpen()) {
      return this.getLocal(key);
    }
    try {
      await this.ensureConnected();
      return await this.client.get(key);
    } catch (error) {
      this.openCircuit(error);
      return this.getLocal(key);
    }
  }

  async setEx(key: string, seconds: number, value: string): Promise<void> {
    this.setLocal(key, seconds, value);
    if (!this.client || this.isCircuitOpen()) {
      return;
    }
    try {
      await this.ensureConnected();
      await this.client.set(key, value, "EX", seconds);
    } catch (error) {
      this.openCircuit(error);
    }
  }

  async setNxEx(key: string, seconds: number, value: string): Promise<boolean | null> {
    if (!this.client || this.isCircuitOpen()) {
      return null;
    }
    try {
      await this.ensureConnected();
      const result = await this.client.set(key, value, "EX", seconds, "NX");
      return result === "OK";
    } catch (error) {
      this.openCircuit(error);
      return null;
    }
  }

  async del(key: string): Promise<void> {
    this.localCache.delete(key);
    if (!this.client || this.isCircuitOpen()) {
      return;
    }
    try {
      await this.ensureConnected();
      await this.client.del(key);
    } catch (error) {
      this.openCircuit(error);
    }
  }

  async delByPrefix(prefix: string): Promise<number> {
    let deleted = 0;
    for (const key of Array.from(this.localCache.keys())) {
      if (key.startsWith(prefix)) {
        this.localCache.delete(key);
        deleted += 1;
      }
    }

    if (!this.client || this.isCircuitOpen()) {
      return deleted;
    }

    try {
      await this.ensureConnected();
      let cursor = "0";
      do {
        const [nextCursor, keys] = await this.client.scan(
          cursor,
          "MATCH",
          `${prefix}*`,
          "COUNT",
          "100"
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          deleted += await this.client.del(...keys);
        }
      } while (cursor !== "0");
      return deleted;
    } catch (error) {
      this.openCircuit(error);
      return deleted;
    }
  }

  async xAdd(stream: string, values: Record<string, string | number | boolean | null | undefined>, maxLen?: number): Promise<void> {
    if (!this.client || this.isCircuitOpen()) {
      return;
    }

    const entries: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      if (value == null) {
        continue;
      }
      entries.push(key, String(value));
    }
    if (!entries.length) {
      return;
    }

    try {
      await this.ensureConnected();
      if (maxLen && maxLen > 0) {
        await this.client.xadd(stream, "MAXLEN", "~", maxLen, "*", ...entries);
      } else {
        await this.client.xadd(stream, "*", ...entries);
      }
    } catch (error) {
      this.openCircuit(error);
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      if (this.client.status === "ready" || this.client.status === "connect") {
        await this.client.quit().catch(() => this.client?.disconnect());
        return;
      }
      this.client.disconnect();
    }
  }

  private isCircuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  private async ensureConnected() {
    if (!this.client) {
      throw new Error("Redis is not configured.");
    }
    if (this.client.status === "wait") {
      await this.client.connect();
    }
    if (this.client.status === "end" || this.client.status === "close") {
      throw new Error(`Redis client is ${this.client.status}.`);
    }
  }

  private openCircuit(error: unknown) {
    this.circuitOpenUntil = Date.now() + REDIS_CIRCUIT_OPEN_MS;
    const now = Date.now();
    if (now - this.lastErrorLogAt <= REDIS_CIRCUIT_OPEN_MS) {
      return;
    }
    this.lastErrorLogAt = now;
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `Redis unavailable; opening auth/cache circuit for ${Math.ceil(
        REDIS_CIRCUIT_OPEN_MS / 1000
      )}s. ${message}`
    );
  }

  private getLocal(key: string): string | null {
    const entry = this.localCache.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.localCache.delete(key);
      return null;
    }
    return entry.value;
  }

  private setLocal(key: string, seconds: number, value: string) {
    if (seconds <= 0) {
      this.localCache.delete(key);
      return;
    }
    if (this.localCache.size >= LOCAL_CACHE_MAX_KEYS) {
      this.pruneLocalCache();
    }
    this.localCache.set(key, {
      value,
      expiresAt: Date.now() + seconds * 1000
    });
  }

  private pruneLocalCache() {
    const now = Date.now();
    for (const [key, entry] of this.localCache) {
      if (entry.expiresAt <= now || this.localCache.size >= LOCAL_CACHE_MAX_KEYS) {
        this.localCache.delete(key);
      }
      if (this.localCache.size < LOCAL_CACHE_MAX_KEYS) {
        return;
      }
    }
  }
}
