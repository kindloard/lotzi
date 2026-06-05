import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from "@nestjs/common";
import { DomainEventStatus, Prisma, type DomainEvent } from "@prisma/client";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { PrismaService } from "../../database/prisma.service";
import { CatalogCacheService } from "../catalog-cache/catalog-cache.service";
import { GeoDiscoveryCacheService } from "../geo-discovery/geo-discovery-cache.service";
import type { GeoCoordinates } from "../geo-discovery/geo-utils";
import { RealtimeCatalogGateway, type CatalogRealtimeEvent } from "../realtime/realtime-catalog.gateway";
import { RedisService } from "../redis/redis.service";

const STREAM = "catalog.events.v1";
const GROUP = "catalog-cache-v1";
const MAX_STREAM_LENGTH = 100_000;
const PUBLISH_BATCH_SIZE = 50;
const MAX_ATTEMPTS = 8;
const DEAD_LETTER_STATUS = "DEAD_LETTER" as DomainEventStatus;

type EventTx = Pick<Prisma.TransactionClient, "domainEvent">;
type DomainEventRow = DomainEvent;

export interface CatalogProductChangedInput {
  eventType?: string;
  storeId: string;
  productId: string;
  tenantId?: string | null;
  variantIds?: string[];
  previousCategoryId?: string | null;
  nextCategoryId?: string | null;
  changedFields: string[];
  catalogVersion?: number | null;
  snapshot?: Record<string, unknown>;
  idempotencyKey?: string | null;
  requestId?: string | null;
}

@Injectable()
export class CatalogEventsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CatalogEventsService.name);
  private readonly consumer = `${hostname()}:${process.pid}:${Math.random().toString(16).slice(2)}`;
  private publishTimer?: NodeJS.Timeout;
  private consumeTimer?: NodeJS.Timeout;
  private publishing = false;
  private consuming = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly cache: CatalogCacheService,
    private readonly realtime: RealtimeCatalogGateway,
    @Optional() private readonly geoCache?: GeoDiscoveryCacheService
  ) {}

  async onApplicationBootstrap() {
    await this.redis.xGroupCreate(STREAM, GROUP);
    this.publishTimer = setInterval(() => {
      void this.publishPending().catch((error) => this.logger.warn(`Catalog outbox publish failed: ${messageOf(error)}`));
    }, 500);
    this.consumeTimer = setInterval(() => {
      void this.consumeStream().catch((error) => this.logger.warn(`Catalog stream consume failed: ${messageOf(error)}`));
    }, 250);
    void this.publishPending();
    void this.consumeStream();
  }

  onModuleDestroy() {
    if (this.publishTimer) {
      clearInterval(this.publishTimer);
    }
    if (this.consumeTimer) {
      clearInterval(this.consumeTimer);
    }
  }

  enqueueProductChanged(
    input: CatalogProductChangedInput,
    tx: EventTx | PrismaService = this.prisma
  ) {
    const eventType = input.eventType ?? "catalog.product.changed.v1";
    const productPublicId = publicProductCode(input.productId);
    const storePublicId = publicStoreCode(input.storeId);
    const occurredAt = new Date();
    return tx.domainEvent.create({
      data: {
        schemaVersion: 1,
        eventType,
        aggregateType: "product",
        aggregateId: input.productId,
        idempotencyKey: input.idempotencyKey ?? `${eventType}:${input.productId}:${occurredAt.getTime()}`,
        occurredAt,
        status: DomainEventStatus.PENDING,
        payload: {
          eventId: null,
          eventType,
          schemaVersion: 1,
          storeId: input.storeId,
          storePublicId,
          tenantId: input.tenantId ?? input.storeId,
          productId: input.productId,
          productPublicId,
          variantIds: input.variantIds ?? [],
          previousCategoryId: input.previousCategoryId ?? null,
          nextCategoryId: input.nextCategoryId ?? null,
          changedFields: Array.from(new Set(input.changedFields)).sort(),
          catalogVersion: input.catalogVersion ?? null,
          occurredAt: occurredAt.toISOString(),
          requestId: input.requestId ?? null,
          snapshot: input.snapshot ?? {}
        } as Prisma.InputJsonValue
      }
    });
  }

  async publishPending() {
    if (this.publishing) {
      return;
    }
    this.publishing = true;
    try {
      const rows = await this.prisma.domainEvent.findMany({
        where: {
          status: { in: [DomainEventStatus.PENDING, DomainEventStatus.FAILED] },
          nextRunAt: { lte: new Date() },
          OR: [
            { eventType: { startsWith: "catalog." } },
            { eventType: { startsWith: "inventory." } },
            { eventType: { startsWith: "shop.location." } }
          ]
        },
        orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
        take: PUBLISH_BATCH_SIZE
      });

      for (const row of rows) {
        await this.publishOne(row);
      }
    } finally {
      this.publishing = false;
    }
  }

  private async publishOne(row: DomainEventRow) {
    const payload = normalizeDomainPayload(row);
    const ok = await this.redis.xAddStrict(
      STREAM,
      {
        eventId: row.id,
        eventType: row.eventType,
        schemaVersion: row.schemaVersion,
        occurredAt: row.occurredAt.toISOString(),
        payload: JSON.stringify(payload)
      },
      MAX_STREAM_LENGTH
    );
    if (!ok) {
      await this.recordPublishFailure(row.id, row.attempts, "redis_stream_unavailable");
      return;
    }

    await this.prisma.domainEvent.update({
      where: { id: row.id },
      data: {
        attempts: { increment: 1 },
        lastError: null,
        publishedAt: new Date(),
        status: DomainEventStatus.PUBLISHED
      }
    });
  }

  private async recordPublishFailure(eventId: string, attempts: number, message: string) {
    const nextAttempts = attempts + 1;
    const deadLetter = nextAttempts >= MAX_ATTEMPTS;
    await this.prisma.domainEvent.update({
      where: { id: eventId },
      data: {
        attempts: { increment: 1 },
        lastError: message.slice(0, 500),
        nextRunAt: retryAt(nextAttempts),
        status: deadLetter ? DEAD_LETTER_STATUS : DomainEventStatus.FAILED
      }
    });
    if (deadLetter) {
      this.logger.error(`Catalog outbox event ${eventId} moved to dead letter after ${nextAttempts} attempts.`);
    }
  }

  private async consumeStream() {
    if (this.consuming) {
      return;
    }
    this.consuming = true;
    try {
      const entries = await this.redis.xReadGroup({
        stream: STREAM,
        group: GROUP,
        consumer: this.consumer,
        count: 50,
        blockMs: 50
      });
      for (const entry of entries) {
        await this.applyStreamEntry(entry.values).finally(() => this.redis.xAck(STREAM, GROUP, entry.id));
      }
    } finally {
      this.consuming = false;
    }
  }

  private async applyStreamEntry(values: Record<string, string>) {
    const eventType = values.eventType ?? "catalog.unknown";
    const payload = parsePayload(values.payload);
    if (eventType.startsWith("inventory.")) {
      await this.applyInventoryEvent(values.eventId, eventType, values.schemaVersion, values.occurredAt, payload);
      return;
    }
    if (eventType.startsWith("shop.location.")) {
      await this.applyShopLocationEvent(payload);
      return;
    }
    await this.applyCatalogEvent(values.eventId, eventType, values.schemaVersion, values.occurredAt, payload);
  }

  private async applyShopLocationEvent(payload: Record<string, unknown>) {
    if (!this.geoCache) {
      return;
    }
    const next = coordinatesValue(payload.next);
    if (!next) {
      return;
    }
    const storeId = stringValue(payload.storeId);
    if (storeId) {
      await this.geoCache.invalidateStoreCards([storeId]);
    }
    await this.geoCache.bumpLocationEpochs({
      previous: coordinatesValue(payload.previous),
      next
    });
  }

  private async applyCatalogEvent(
    eventId: string | undefined,
    eventType: string,
    schemaVersion: string | undefined,
    occurredAt: string | undefined,
    payload: Record<string, unknown>
  ) {
    const storePublicId = stringValue(payload.storePublicId);
    const productPublicId = stringValue(payload.productPublicId);
    const scopes = [
      storePublicId ? this.cache.storePublicScope(storePublicId) : "",
      storePublicId ? this.cache.searchScope(this.cache.storePublicScope(storePublicId)) : "",
      productPublicId ? this.cache.productPublicScope(productPublicId) : "",
      this.cache.dealsScope(),
      this.cache.landingShopsScope()
    ];
    const previousCategoryId = stringValue(payload.previousCategoryId);
    const nextCategoryId = stringValue(payload.nextCategoryId);
    if (storePublicId && previousCategoryId) {
      scopes.push(this.cache.categoryScope(this.cache.storePublicScope(storePublicId), previousCategoryId));
    }
    if (storePublicId && nextCategoryId) {
      scopes.push(this.cache.categoryScope(this.cache.storePublicScope(storePublicId), nextCategoryId));
    }
    await this.cache.bumpScopes(scopes);
    const storeId = stringValue(payload.storeId);
    if (this.geoCache && storeId) {
      await this.geoCache.invalidateStoreCards([storeId]);
    }
    this.realtime.broadcast(toRealtimeEvent(eventId, eventType, schemaVersion, occurredAt, payload));
  }

  private async applyInventoryEvent(
    eventId: string | undefined,
    eventType: string,
    schemaVersion: string | undefined,
    occurredAt: string | undefined,
    payload: Record<string, unknown>
  ) {
    const storeId = stringValue(payload.storeId);
    const productVariantId = stringValue(payload.payload, "productVariantId") ?? stringValue(payload.productVariantId);
    if (!storeId || !productVariantId) {
      return;
    }

    const variant = await this.prisma.productVariant.findUnique({
      where: { id: productVariantId },
      select: {
        productId: true,
        product: {
          select: {
            catalogVersion: true,
            storeId: true
          }
        }
      }
    });
    if (!variant) {
      return;
    }
    const storePublicId = publicStoreCode(variant.product.storeId);
    const productPublicId = publicProductCode(variant.productId);
    await this.cache.bumpScopes([
      this.cache.storePublicScope(storePublicId),
      this.cache.searchScope(this.cache.storePublicScope(storePublicId)),
      this.cache.productPublicScope(productPublicId),
      this.cache.dealsScope()
    ]);
    if (this.geoCache) {
      await this.geoCache.invalidateStoreCards([storeId]);
    }
    this.realtime.broadcast({
      eventId: eventId ?? `${eventType}:${productVariantId}`,
      eventType: "catalog.product.changed.v1",
      schemaVersion: Number(schemaVersion ?? 1),
      occurredAt: occurredAt ?? new Date().toISOString(),
      storeId,
      storePublicId,
      productId: variant.productId,
      productPublicId,
      changedFields: ["inventory"],
      snapshot: {
        catalogVersion: variant.product.catalogVersion,
        productVariantId
      }
    });
  }
}

function normalizeDomainPayload(row: {
  id: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: Date;
  payload: Prisma.JsonValue;
}) {
  const payload = isRecord(row.payload) ? row.payload : {};
  return {
    ...payload,
    eventId: stringValue(payload.eventId) ?? row.id,
    eventType: stringValue(payload.eventType) ?? row.eventType,
    schemaVersion: Number(payload.schemaVersion ?? row.schemaVersion),
    occurredAt: stringValue(payload.occurredAt) ?? row.occurredAt.toISOString()
  };
}

function toRealtimeEvent(
  eventId: string | undefined,
  eventType: string,
  schemaVersion: string | undefined,
  occurredAt: string | undefined,
  payload: Record<string, unknown>
): CatalogRealtimeEvent {
  return {
    eventId: stringValue(payload.eventId) ?? eventId ?? `${eventType}:${Date.now()}`,
    eventType,
    schemaVersion: Number(schemaVersion ?? payload.schemaVersion ?? 1),
    occurredAt: stringValue(payload.occurredAt) ?? occurredAt ?? new Date().toISOString(),
    storeId: stringValue(payload.storeId),
    storePublicId: stringValue(payload.storePublicId),
    productId: stringValue(payload.productId),
    productPublicId: stringValue(payload.productPublicId),
    changedFields: Array.isArray(payload.changedFields)
      ? payload.changedFields.filter((item): item is string => typeof item === "string")
      : [],
    snapshot: isRecord(payload.snapshot) ? payload.snapshot : {}
  };
}

function parsePayload(value: string | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown, nestedKey?: string): string | null {
  if (nestedKey && isRecord(value)) {
    return stringValue(value[nestedKey]);
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function coordinatesValue(value: unknown): GeoCoordinates | null {
  if (!isRecord(value)) {
    return null;
  }
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    ? { latitude, longitude }
    : null;
}

function retryAt(attempts: number) {
  const delayMs = Math.min(5 * 60_000, 500 * 2 ** Math.max(0, attempts - 1));
  return new Date(Date.now() + delayMs);
}

function publicStoreCode(storeId: string) {
  const hash = createHash("sha256").update(storeId).digest("hex");
  const numeric = BigInt(`0x${hash.slice(0, 12)}`) % 1_000_000n;
  return numeric.toString().padStart(6, "0");
}

function publicProductCode(productId: string) {
  return productId.replace(/-/g, "").toLowerCase();
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
