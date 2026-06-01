import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { IdempotencyStatus, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { RedisService } from "../redis/redis.service";

export type IdempotencyReservation =
  | {
      state: "reserved";
      key: string;
      userId: string;
      storeId?: string;
      operation: string;
      requestHash: string;
      expiresAt: Date;
      redisKey?: string;
      ttlSeconds: number;
    }
  | { state: "replayed"; response: unknown };

interface ReserveInput {
  key: string;
  userId: string;
  storeId?: string;
  operation: string;
  requestHash: string;
  ttlMs?: number;
}

const DEFAULT_FINANCIAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IDEMPOTENCY_CACHE_PREFIX = "idempotency:v1";

interface CachedIdempotencyRecord {
  userId: string;
  storeId?: string;
  operation: string;
  requestHash: string;
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
  responseJson?: unknown;
  expiresAt: string;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  hash(input: unknown): string {
    return createHash("sha256").update(stableJson(input)).digest("hex");
  }

  async reserve(input: ReserveInput): Promise<IdempotencyReservation> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_FINANCIAL_TTL_MS));
    const ttlSeconds = Math.max(1, Math.ceil((input.ttlMs ?? DEFAULT_FINANCIAL_TTL_MS) / 1000));
    const redisKey = this.cacheKey(input.key);
    const cachedReservation = await this.reserveCached(input, redisKey, expiresAt, ttlSeconds, now);
    if (cachedReservation) {
      return cachedReservation;
    }

    try {
      await this.prisma.idempotencyKey.create({
        data: {
          key: input.key,
          storeId: input.storeId,
          userId: input.userId,
          operation: input.operation,
          requestHash: input.requestHash,
          status: IdempotencyStatus.IN_PROGRESS,
          expiresAt
        }
      });
      return {
        state: "reserved",
        key: input.key,
        userId: input.userId,
        storeId: input.storeId,
        operation: input.operation,
        requestHash: input.requestHash,
        expiresAt,
        ttlSeconds
      };
    } catch (error) {
      if (!isUniqueConflict(error)) {
        throw error;
      }
    }

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { key: input.key }
    });
    if (!existing || existing.expiresAt <= now || existing.status === IdempotencyStatus.FAILED) {
      await this.prisma.idempotencyKey.upsert({
        where: { key: input.key },
        create: {
          key: input.key,
          storeId: input.storeId,
          userId: input.userId,
          operation: input.operation,
          requestHash: input.requestHash,
          status: IdempotencyStatus.IN_PROGRESS,
          expiresAt
        },
        update: {
          storeId: input.storeId,
          userId: input.userId,
          operation: input.operation,
          requestHash: input.requestHash,
          status: IdempotencyStatus.IN_PROGRESS,
          responseJson: Prisma.JsonNull,
          expiresAt
        }
      });
      return {
        state: "reserved",
        key: input.key,
        userId: input.userId,
        storeId: input.storeId,
        operation: input.operation,
        requestHash: input.requestHash,
        expiresAt,
        ttlSeconds
      };
    }

    if (existing.operation !== input.operation || existing.userId !== input.userId || existing.requestHash !== input.requestHash) {
      throw new ConflictException({
        apiVersion: "v1",
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "This idempotency key was already used for a different request.",
        retryable: false
      });
    }

    if (existing.status === IdempotencyStatus.COMPLETED) {
      return { state: "replayed", response: existing.responseJson };
    }

    throw new ConflictException({
      apiVersion: "v1",
      code: "IDEMPOTENCY_IN_PROGRESS",
      message: "An identical request is already in progress.",
      retryable: true,
      retryAfterSeconds: 3
    });
  }

  async complete(reservation: Extract<IdempotencyReservation, { state: "reserved" }>, response: unknown) {
    if (reservation.redisKey) {
      await this.redis.setEx(
        reservation.redisKey,
        reservation.ttlSeconds,
        JSON.stringify({
          userId: reservation.userId,
          storeId: reservation.storeId,
          operation: reservation.operation,
          requestHash: reservation.requestHash,
          status: "COMPLETED",
          responseJson: response,
          expiresAt: reservation.expiresAt.toISOString()
        } satisfies CachedIdempotencyRecord)
      );
      this.completeDbAsync(reservation, response);
      return;
    }

    await this.prisma.idempotencyKey.update({
      where: { key: reservation.key },
      data: {
        status: IdempotencyStatus.COMPLETED,
        responseJson: response as Prisma.InputJsonValue
      }
    });
  }

  async fail(reservation: Extract<IdempotencyReservation, { state: "reserved" }>, response?: unknown) {
    if (reservation.redisKey) {
      await this.redis.del(reservation.redisKey);
      this.failDbAsync(reservation, response);
      return;
    }

    await this.prisma.idempotencyKey.update({
      where: { key: reservation.key },
      data: {
        status: IdempotencyStatus.FAILED,
        responseJson: response === undefined ? Prisma.JsonNull : (response as Prisma.InputJsonValue)
      }
    }).catch(() => undefined);
  }

  private async reserveCached(
    input: ReserveInput,
    redisKey: string,
    expiresAt: Date,
    ttlSeconds: number,
    now: Date
  ): Promise<IdempotencyReservation | null> {
    const record: CachedIdempotencyRecord = {
      userId: input.userId,
      storeId: input.storeId,
      operation: input.operation,
      requestHash: input.requestHash,
      status: "IN_PROGRESS",
      expiresAt: expiresAt.toISOString()
    };
    const reserved = await this.redis.setNxEx(redisKey, ttlSeconds, JSON.stringify(record));
    if (reserved === null) {
      return null;
    }

    if (reserved) {
      this.createDbAsync(input, expiresAt);
      return {
        state: "reserved",
        key: input.key,
        userId: input.userId,
        storeId: input.storeId,
        operation: input.operation,
        requestHash: input.requestHash,
        expiresAt,
        redisKey,
        ttlSeconds
      };
    }

    const cached = parseCachedRecord(await this.redis.get(redisKey));
    if (!cached || new Date(cached.expiresAt) <= now || cached.status === "FAILED") {
      await this.redis.del(redisKey);
      return this.reserve(input);
    }
    if (cached.operation !== input.operation || cached.userId !== input.userId || cached.requestHash !== input.requestHash) {
      throw idempotencyReuseConflict();
    }
    if (cached.status === "COMPLETED") {
      return { state: "replayed", response: cached.responseJson };
    }
    throw idempotencyInProgressConflict();
  }

  private createDbAsync(input: ReserveInput, expiresAt: Date) {
    void this.prisma.idempotencyKey.create({
      data: {
        key: input.key,
        storeId: input.storeId,
        userId: input.userId,
        operation: input.operation,
        requestHash: input.requestHash,
        status: IdempotencyStatus.IN_PROGRESS,
        expiresAt
      }
    }).catch((error) => {
      if (!isUniqueConflict(error)) {
        this.logger.warn(`Async idempotency reservation persistence failed: ${messageOf(error)}`);
      }
    });
  }

  private completeDbAsync(reservation: Extract<IdempotencyReservation, { state: "reserved" }>, response: unknown) {
    void this.prisma.idempotencyKey.upsert({
      where: { key: reservation.key },
      create: {
        key: reservation.key,
        storeId: reservation.storeId,
        userId: reservation.userId,
        operation: reservation.operation,
        requestHash: reservation.requestHash,
        status: IdempotencyStatus.COMPLETED,
        responseJson: response as Prisma.InputJsonValue,
        expiresAt: reservation.expiresAt
      },
      update: {
        status: IdempotencyStatus.COMPLETED,
        responseJson: response as Prisma.InputJsonValue,
        expiresAt: reservation.expiresAt
      }
    }).catch((error) => {
      this.logger.warn(`Async idempotency completion persistence failed: ${messageOf(error)}`);
    });
  }

  private failDbAsync(reservation: Extract<IdempotencyReservation, { state: "reserved" }>, response?: unknown) {
    void this.prisma.idempotencyKey.update({
      where: { key: reservation.key },
      data: {
        status: IdempotencyStatus.FAILED,
        responseJson: response === undefined ? Prisma.JsonNull : (response as Prisma.InputJsonValue)
      }
    }).catch(() => undefined);
  }

  private cacheKey(key: string) {
    return `${IDEMPOTENCY_CACHE_PREFIX}:${key}`;
  }
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function idempotencyReuseConflict() {
  return new ConflictException({
    apiVersion: "v1",
    code: "IDEMPOTENCY_KEY_REUSED",
    message: "This idempotency key was already used for a different request.",
    retryable: false
  });
}

function idempotencyInProgressConflict() {
  return new ConflictException({
    apiVersion: "v1",
    code: "IDEMPOTENCY_IN_PROGRESS",
    message: "An identical request is already in progress.",
    retryable: true,
    retryAfterSeconds: 3
  });
}

function parseCachedRecord(value: string | null): CachedIdempotencyRecord | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<CachedIdempotencyRecord>;
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.operation !== "string" ||
      typeof parsed.requestHash !== "string" ||
      typeof parsed.expiresAt !== "string" ||
      !["IN_PROGRESS", "COMPLETED", "FAILED"].includes(String(parsed.status))
    ) {
      return null;
    }
    return parsed as CachedIdempotencyRecord;
  } catch {
    return null;
  }
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function stableJson(input: unknown): string {
  return JSON.stringify(sortJson(input));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortJson(item)])
    );
  }
  return value;
}
