import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, StoreStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { GeoDiscoveryCacheService } from "./geo-discovery-cache.service";
import {
  normalizeCoordinate,
  numberFromDb,
  parseLatitude,
  parseLongitude,
  type GeoCoordinates,
  type GeoLocationChange
} from "./geo-utils";

export interface StoreLocationPatch {
  addressLine?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface StoreLocationUpdateInput extends StoreLocationPatch {
  storeId: string;
  latitude: number;
  longitude: number;
  actorUserId?: string | null;
  operation: string;
}

export interface StoreLocationRow {
  id: string;
  name: string;
  slug: string;
  status: StoreStatus;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
  updatedAt: Date;
}

@Injectable()
export class GeoLocationWriter {
  private readonly logger = new Logger(GeoLocationWriter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: GeoDiscoveryCacheService
  ) {}

  async updateStoreLocation(input: StoreLocationUpdateInput): Promise<StoreLocationRow> {
    let change: GeoLocationChange | null = null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await this.updateStoreLocationInTransaction(tx, input);
      change = result.change;
      return result.store;
    });
    if (change) {
      await this.bumpEpochs(change, input.operation);
    }
    return updated;
  }

  async updateStoreLocationInTransaction(
    tx: Prisma.TransactionClient,
    input: StoreLocationUpdateInput
  ): Promise<{ store: StoreLocationRow; change: GeoLocationChange }> {
    const latitude = normalizeCoordinate(parseLatitude(input.latitude), -90, 90);
    const longitude = normalizeCoordinate(parseLongitude(input.longitude), -180, 180);
    const previous = await tx.store.findUnique({
      where: { id: input.storeId },
      select: {
        id: true,
        latitude: true,
        longitude: true
      }
    });
    if (!previous) {
      throw new NotFoundException("Store was not found.");
    }

    const setFragments = [
      Prisma.sql`"latitude" = ${latitude}`,
      Prisma.sql`"longitude" = ${longitude}`,
      Prisma.sql`"location" = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography`,
      Prisma.sql`"updated_at" = now()`
    ];
    if (input.addressLine !== undefined) {
      setFragments.push(Prisma.sql`"address_line" = ${nullableText(input.addressLine)}`);
    }
    if (input.city !== undefined) {
      setFragments.push(Prisma.sql`"city" = ${nullableText(input.city)}`);
    }
    if (input.state !== undefined) {
      setFragments.push(Prisma.sql`"state" = ${nullableText(input.state)}`);
    }
    if (input.pincode !== undefined) {
      setFragments.push(Prisma.sql`"pincode" = ${nullableText(input.pincode)}`);
    }

    await tx.$executeRaw(Prisma.sql`
      UPDATE "stores"
      SET ${Prisma.join(setFragments, ", ")}
      WHERE "id" = ${input.storeId}::uuid
    `);

    const store = await tx.store.findUniqueOrThrow({
      where: { id: input.storeId },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        addressLine: true,
        city: true,
        state: true,
        pincode: true,
        latitude: true,
        longitude: true,
        updatedAt: true
      }
    });

    const previousCoordinates = coordinatesFrom(previous);
    const next = { latitude, longitude };
    const payload = {
      storeId: input.storeId,
      previous: jsonCoordinates(previousCoordinates),
      next: jsonCoordinates(next),
      actorUserId: input.actorUserId ?? null,
      operation: input.operation,
      occurredAt: new Date().toISOString()
    } as Prisma.InputJsonObject;
    await tx.domainEvent.create({
      data: {
        schemaVersion: 1,
        eventType: "shop.location.changed.v1",
        aggregateType: "store",
        aggregateId: input.storeId,
        idempotencyKey: `shop.location.changed.v1:${input.storeId}:${randomUUID()}`,
        payload
      }
    });

    return {
      store,
      change: {
        storeId: input.storeId,
        previous: previousCoordinates,
        next
      }
    };
  }

  async bumpEpochs(change: GeoLocationChange, operation: string): Promise<void> {
    try {
      await this.cache.bumpLocationEpochs(change);
    } catch (error) {
      this.logger.warn(JSON.stringify({
        event: "geo_epoch_bump_failed",
        operation,
        storeId: change.storeId,
        message: error instanceof Error ? error.message : String(error)
      }));
    }
  }
}

function coordinatesFrom(value: { latitude: Prisma.Decimal | number | string | null; longitude: Prisma.Decimal | number | string | null }): GeoCoordinates | null {
  const latitude = numberFromDb(value.latitude);
  const longitude = numberFromDb(value.longitude);
  return latitude == null || longitude == null ? null : { latitude, longitude };
}

function nullableText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function jsonCoordinates(value: GeoCoordinates | null): Prisma.InputJsonObject | null {
  return value
    ? {
        latitude: value.latitude,
        longitude: value.longitude
      }
    : null;
}
