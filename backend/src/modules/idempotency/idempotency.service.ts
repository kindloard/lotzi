import { ConflictException, Injectable } from "@nestjs/common";
import { IdempotencyStatus, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";

export type IdempotencyReservation =
  | {
      state: "reserved";
      key: string;
      userId: string;
      storeId?: string;
      operation: string;
      requestHash: string;
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

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  hash(input: unknown): string {
    return createHash("sha256").update(stableJson(input)).digest("hex");
  }

  async reserve(input: ReserveInput): Promise<IdempotencyReservation> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_FINANCIAL_TTL_MS));

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
        requestHash: input.requestHash
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
        requestHash: input.requestHash
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
    await this.prisma.idempotencyKey.update({
      where: { key: reservation.key },
      data: {
        status: IdempotencyStatus.COMPLETED,
        responseJson: response as Prisma.InputJsonValue
      }
    });
  }

  async fail(reservation: Extract<IdempotencyReservation, { state: "reserved" }>, response?: unknown) {
    await this.prisma.idempotencyKey.update({
      where: { key: reservation.key },
      data: {
        status: IdempotencyStatus.FAILED,
        responseJson: response === undefined ? Prisma.JsonNull : (response as Prisma.InputJsonValue)
      }
    }).catch(() => undefined);
  }
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
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
