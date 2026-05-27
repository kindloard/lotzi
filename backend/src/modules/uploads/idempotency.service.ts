import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { IdempotencyStatus, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { RedisService } from "../redis/redis.service";
import { V1ErrorBody } from "./uploads.errors";

export type IdempotencyReservation =
  | {
      state: "reserved";
      key: string;
      backend: "redis" | "database";
      reservationId: string;
      storeId?: string;
      userId: string;
      operation: string;
      requestHash: string;
    }
  | { state: "replayed"; response: unknown };

interface ReserveInput {
  key: string;
  storeId?: string;
  userId: string;
  operation: string;
  requestHash: string;
}

interface RedisIdempotencyEntry {
  status: "IN_PROGRESS" | "COMPLETED";
  requestHash: string;
  reservationId?: string;
  storeId?: string;
  userId: string;
  operation: string;
  response?: unknown;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const UPLOAD_IMAGE_TTL_MS = 10 * 60 * 1000;
const UPLOAD_IN_PROGRESS_TTL_SECONDS = 60;
const UPLOAD_COMPLETED_TTL_SECONDS = 10 * 60;

const COMPLETE_IF_RESERVED_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if not current then
  return 0
end
local decoded = cjson.decode(current)
if decoded["status"] ~= "IN_PROGRESS" or decoded["reservationId"] ~= ARGV[1] then
  return -1
end
redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])
return 1
`;

const DELETE_IF_RESERVED_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if not current then
  return 0
end
local decoded = cjson.decode(current)
if decoded["status"] ~= "IN_PROGRESS" or decoded["reservationId"] ~= ARGV[1] then
  return -1
end
redis.call("DEL", KEYS[1])
return 1
`;

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService
  ) {}

  async reserve(input: ReserveInput): Promise<IdempotencyReservation> {
    const redisReservation = await this.reserveInRedis(input);
    if (redisReservation) {
      return redisReservation;
    }
    return this.reserveInDatabase(input);
  }

  async complete(
    reservation: Extract<IdempotencyReservation, { state: "reserved" }> | undefined,
    response: unknown
  ): Promise<void> {
    if (!reservation) {
      return;
    }

    if (reservation.backend === "database") {
      await this.completeInDatabase(reservation.key, response);
      return;
    }

    const entry: RedisIdempotencyEntry = {
      status: "COMPLETED",
      requestHash: reservation.requestHash,
      storeId: reservation.storeId,
      userId: reservation.userId,
      operation: reservation.operation,
      response
    };
    const result = await this.redis
      .eval(COMPLETE_IF_RESERVED_SCRIPT, [this.redisKey(reservation.key)], [
        reservation.reservationId,
        JSON.stringify(entry),
        UPLOAD_COMPLETED_TTL_SECONDS
      ])
      .catch((error) => {
        this.logger.warn(`Redis idempotency complete failed: ${messageOf(error)}`);
        return 0;
      });

    if (Number(result) < 0) {
      this.logger.warn(`Skipped stale idempotency completion for ${reservation.key}.`);
      return;
    }

    void this.persistCompleted(reservation, response);
  }

  async fail(
    reservation: Extract<IdempotencyReservation, { state: "reserved" }> | undefined,
    response?: unknown
  ): Promise<void> {
    if (!reservation) {
      return;
    }
    if (reservation.backend === "database") {
      await this.failInDatabase(reservation.key, response);
      return;
    }
    const result = await this.redis
      .eval(DELETE_IF_RESERVED_SCRIPT, [this.redisKey(reservation.key)], [reservation.reservationId])
      .catch((error) => {
        this.logger.warn(`Redis idempotency fail cleanup failed: ${messageOf(error)}`);
        return 0;
      });
    if (Number(result) < 0) {
      this.logger.warn(`Skipped stale idempotency failure cleanup for ${reservation.key}.`);
    }
  }

  private async reserveInRedis(input: ReserveInput): Promise<IdempotencyReservation | null> {
    const reservationId = randomUUID();
    const entry: RedisIdempotencyEntry = {
      status: "IN_PROGRESS",
      requestHash: input.requestHash,
      reservationId,
      storeId: input.storeId,
      userId: input.userId,
      operation: input.operation
    };
    const reserved = await this.redis.setNxEx(
      this.redisKey(input.key),
      UPLOAD_IN_PROGRESS_TTL_SECONDS,
      JSON.stringify(entry)
    );
    if (reserved === null) {
      return null;
    }
    if (reserved) {
      return {
        state: "reserved",
        key: input.key,
        backend: "redis",
        reservationId,
        storeId: input.storeId,
        userId: input.userId,
        operation: input.operation,
        requestHash: input.requestHash
      };
    }

    const existing = parseRedisEntry(await this.redis.get(this.redisKey(input.key)));
    if (!existing) {
      return null;
    }
    if (existing.requestHash !== input.requestHash) {
      throw new ConflictException(errorBody("IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for a different request."));
    }
    if (existing.status === "COMPLETED") {
      return { state: "replayed", response: existing.response };
    }
    throw new ConflictException(errorBody("IDEMPOTENCY_IN_PROGRESS", "An identical request is already in progress.", true, 3));
  }

  private async reserveInDatabase(input: ReserveInput): Promise<IdempotencyReservation> {
    const now = new Date();
    const expiresAt = new Date(Date.now() + ttlForOperation(input.operation));
    const reservationId = randomUUID();
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
      return databaseReservation(input, reservationId);
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
      return databaseReservation(input, reservationId);
    }

    if (existing.requestHash !== input.requestHash) {
      throw new ConflictException(errorBody("IDEMPOTENCY_KEY_REUSED", "This idempotency key was already used for a different request."));
    }

    if (existing.status === IdempotencyStatus.COMPLETED) {
      return { state: "replayed", response: existing.responseJson };
    }

    throw new ConflictException(errorBody("IDEMPOTENCY_IN_PROGRESS", "An identical request is already in progress.", true, 3));
  }

  private async completeInDatabase(key: string, response: unknown): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { key },
      data: {
        status: IdempotencyStatus.COMPLETED,
        responseJson: response as Prisma.InputJsonValue
      }
    });
  }

  private async failInDatabase(key: string, response?: unknown): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { key },
      data: {
        status: IdempotencyStatus.FAILED,
        responseJson: response === undefined ? Prisma.JsonNull : (response as Prisma.InputJsonValue)
      }
    }).catch(() => undefined);
  }

  private async persistCompleted(
    reservation: Extract<IdempotencyReservation, { state: "reserved" }>,
    response: unknown
  ) {
    const expiresAt = new Date(Date.now() + ttlForOperation(reservation.operation));
    await this.prisma.idempotencyKey.upsert({
      where: { key: reservation.key },
      create: {
        key: reservation.key,
        storeId: reservation.storeId,
        userId: reservation.userId,
        operation: reservation.operation,
        requestHash: reservation.requestHash,
        status: IdempotencyStatus.COMPLETED,
        responseJson: response as Prisma.InputJsonValue,
        expiresAt
      },
      update: {
        storeId: reservation.storeId,
        userId: reservation.userId,
        operation: reservation.operation,
        requestHash: reservation.requestHash,
        status: IdempotencyStatus.COMPLETED,
        responseJson: response as Prisma.InputJsonValue,
        expiresAt
      }
    }).catch((error) => {
      this.logger.warn(`Async idempotency DB persistence failed: ${messageOf(error)}`);
    });
  }

  private redisKey(key: string) {
    return `idempotency:${key}`;
  }
}

function ttlForOperation(operation: string): number {
  return operation === "upload.image.v1" ? UPLOAD_IMAGE_TTL_MS : DEFAULT_TTL_MS;
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function parseRedisEntry(value: string | null): RedisIdempotencyEntry | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as Partial<RedisIdempotencyEntry>;
    if (
      !parsed ||
      (parsed.status !== "IN_PROGRESS" && parsed.status !== "COMPLETED") ||
      typeof parsed.requestHash !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.operation !== "string"
    ) {
      return null;
    }
    return parsed as RedisIdempotencyEntry;
  } catch {
    return null;
  }
}

function databaseReservation(input: ReserveInput, reservationId: string): Extract<IdempotencyReservation, { state: "reserved" }> {
  return {
    state: "reserved",
    key: input.key,
    backend: "database",
    reservationId,
    storeId: input.storeId,
    userId: input.userId,
    operation: input.operation,
    requestHash: input.requestHash
  };
}

function errorBody(
  code: string,
  message: string,
  retryable = false,
  retryAfterSeconds?: number
): V1ErrorBody {
  return {
    apiVersion: "v1",
    code,
    message,
    retryable,
    retryAfterSeconds
  };
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
