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
      if (process.env.NODE_ENV === "production") {
        throw new Error("REDIS_URL must be configured in production for geo discovery cache, stampede protection, and rate limits.");
      }
      this.logger.warn("REDIS_URL is not configured. Auth rate limits use emergency in-process fallback.");
      return;
    }

    this.client = new Redis(url, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
      // 50ms command timeout: co-located Redis completes in <1ms; 50ms catches hung connections.
      commandTimeout: 50,
      // 150ms connect timeout: safe for same-host or container-to-container.
      connectTimeout: 150,
      keepAlive: 1000,
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

  get isCircuitBreakerOpen(): boolean {
    return this.isCircuitOpen();
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

  async getStrict(key: string): Promise<string | null> {
    if (!this.client || this.isCircuitOpen()) {
      return null;
    }
    try {
      await this.ensureConnected();
      return await this.client.get(key);
    } catch (error) {
      this.openCircuit(error);
      return null;
    }
  }

  /**
   * Batch GET: single MGET round-trip for N keys.
   * Falls back to null map when Redis is unavailable (strict — no local cache).
   * Returns a Map<key, value|null>.
   */
  async mGetStrict(keys: string[]): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>(keys.map((k) => [k, null]));
    if (!keys.length) {
      return result;
    }
    if (!this.client || this.isCircuitOpen()) {
      return result;
    }
    try {
      await this.ensureConnected();
      const values = await this.client.mget(...keys);
      for (let i = 0; i < keys.length; i += 1) {
        result.set(keys[i]!, values[i] ?? null);
      }
      return result;
    } catch (error) {
      this.openCircuit(error);
      return result;
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

  async setExStrict(key: string, seconds: number, value: string): Promise<boolean> {
    if (!this.client || this.isCircuitOpen()) {
      return false;
    }
    try {
      await this.ensureConnected();
      await this.client.set(key, value, "EX", seconds);
      return true;
    } catch (error) {
      this.openCircuit(error);
      return false;
    }
  }

  async incr(key: string): Promise<number | null> {
    this.localCache.delete(key);
    if (!this.client || this.isCircuitOpen()) {
      return null;
    }
    try {
      await this.ensureConnected();
      return await this.client.incr(key);
    } catch (error) {
      this.openCircuit(error);
      return null;
    }
  }

  async setNxEx(key: string, seconds: number, value: string): Promise<boolean | null> {
    if (!this.client || this.isCircuitOpen()) {
      return this.allowLocalOnlyFallback() ? this.setLocalNx(key, seconds, value) : null;
    }
    try {
      await this.ensureConnected();
      const result = await this.client.set(key, value, "EX", seconds, "NX");
      return result === "OK";
    } catch (error) {
      this.openCircuit(error);
      return this.allowLocalOnlyFallback() ? this.setLocalNx(key, seconds, value) : null;
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
    await this.xAddStrict(stream, values, maxLen);
  }

  async xAddStrict(stream: string, values: Record<string, string | number | boolean | null | undefined>, maxLen?: number): Promise<boolean> {
    if (!this.client || this.isCircuitOpen()) {
      return false;
    }

    const entries: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      if (value == null) {
        continue;
      }
      entries.push(key, String(value));
    }
    if (!entries.length) {
      return true;
    }

    try {
      await this.ensureConnected();
      if (maxLen && maxLen > 0) {
        await this.client.xadd(stream, "MAXLEN", "~", maxLen, "*", ...entries);
      } else {
        await this.client.xadd(stream, "*", ...entries);
      }
      return true;
    } catch (error) {
      this.openCircuit(error);
      return false;
    }
  }

  async xGroupCreate(stream: string, group: string): Promise<boolean> {
    if (!this.client || this.isCircuitOpen()) {
      return false;
    }
    try {
      await this.ensureConnected();
      await this.client.xgroup("CREATE", stream, group, "$", "MKSTREAM");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("BUSYGROUP")) {
        return true;
      }
      this.openCircuit(error);
      return false;
    }
  }

  async xReadGroup(input: {
    stream: string;
    group: string;
    consumer: string;
    count?: number;
    blockMs?: number;
  }): Promise<Array<{ id: string; values: Record<string, string> }>> {
    if (!this.client || this.isCircuitOpen()) {
      return [];
    }
    try {
      await this.ensureConnected();
      const response = await this.client.xreadgroup(
        "GROUP",
        input.group,
        input.consumer,
        "COUNT",
        input.count ?? 25,
        "BLOCK",
        input.blockMs ?? 1000,
        "STREAMS",
        input.stream,
        ">"
      ) as Array<[string, Array<[string, string[]]>]> | null;
      const stream = response?.[0]?.[1] ?? [];
      return stream.map(([id, entries]) => ({
        id,
        values: entriesToObject(entries)
      }));
    } catch (error) {
      this.openCircuit(error);
      return [];
    }
  }

  async xAck(stream: string, group: string, id: string): Promise<void> {
    if (!this.client || this.isCircuitOpen()) {
      return;
    }
    try {
      await this.ensureConnected();
      await this.client.xack(stream, group, id);
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

  private setLocalNx(key: string, seconds: number, value: string) {
    if (this.getLocal(key) !== null) {
      return false;
    }
    this.setLocal(key, seconds, value);
    return true;
  }

  private allowLocalOnlyFallback() {
    return process.env.NODE_ENV !== "production";
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

function entriesToObject(entries: string[]) {
  const result: Record<string, string> = {};
  for (let index = 0; index < entries.length; index += 2) {
    const key = entries[index];
    const value = entries[index + 1];
    if (key !== undefined && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
