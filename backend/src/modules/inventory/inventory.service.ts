import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import {
  DomainEventStatus,
  InventoryLedgerType,
  InventoryOperationStatus,
  InventoryReservationStatus,
  Prisma
} from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { paymentError } from "../payments/payment.errors";
import { RedisService } from "../redis/redis.service";
import { ShopsService } from "../shops/shops.service";
import { InventoryAdjustmentDto, InventoryReconcileDto } from "./dto/inventory.dto";

const MAX_INVENTORY_LOCK_LINES = 50;
const OPERATION_CLAIM_MS = 5 * 60 * 1000;
const OPERATION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const LOW_STOCK_DEDUPE_MS = 24 * 60 * 60 * 1000;
const INVENTORY_ADMISSION_WINDOW_SECONDS = 30;
const INVENTORY_ADMISSION_LIMIT = 500;
const DEFAULT_LOCATION_CACHE_TTL_MS = 60_000;

type Tx = Prisma.TransactionClient;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

interface ReserveOrderStockInput {
  storeId: string;
  userId: string;
  orderId: string;
  items: Array<{ productVariantId: string; quantity: number }>;
  expiresAt: Date;
  idempotencyKey: string;
  requestId?: string;
}

interface ConfirmOrderStockInput {
  storeId: string;
  orderId: string;
  idempotencyKey: string;
  requestId?: string;
}

interface AuthorizeCodOrderStockInput {
  storeId: string;
  userId: string;
  orderId: string;
  items: Array<{ productVariantId: string; quantity: number }>;
  expiresAt: Date;
  idempotencyKey: string;
  requestId?: string;
}

interface ReleaseOrderStockInput {
  storeId: string;
  orderId: string;
  reason: string;
  status?: InventoryReservationStatus;
  idempotencyKey: string;
  actorType?: string;
  actorUserId?: string;
  requestId?: string;
}

interface InitializeCatalogInventoryInput {
  storeId: string;
  variants: Array<{ productVariantId: string; availableStock: number }>;
  reason: string;
  idempotencyKey: string;
  requestId?: string;
}

interface LockedInventoryItem {
  id: string;
  storeId: string;
  productVariantId: string;
  locationId: string;
  availableStock: number;
  reservedStock: number;
  soldStock: number;
  lowStockThreshold: number;
  version: number;
}

interface LockedReservation {
  id: string;
  storeId: string;
  orderId: string;
  productVariantId: string;
  locationId: string;
  quantity: number;
  status: InventoryReservationStatus;
  expiresAt: Date;
}

type ReservationForRelease = Pick<
  LockedReservation,
  "id" | "storeId" | "orderId" | "productVariantId" | "locationId" | "quantity"
>;

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);
  private readonly defaultLocationCache = new Map<string, CacheEntry<{ id: string }>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly shops: ShopsService
  ) {}

  hash(input: unknown): string {
    return createHash("sha256").update(stableJson(input)).digest("hex");
  }

  async admitCheckout(input: { storeId: string; items: Array<{ productVariantId: string }> }) {
    const variants = Array.from(new Set(input.items.map((item) => item.productVariantId))).sort();
    if (!variants.length || !this.redis.isConfigured) {
      return;
    }
    const script = `
      local current = redis.call("INCR", KEYS[1])
      if current == 1 then
        redis.call("EXPIRE", KEYS[1], ARGV[2])
      end
      if current > tonumber(ARGV[1]) then
        return 0
      end
      return current
    `;
    await Promise.all(variants.map(async (productVariantId) => {
      const admitted = await this.redis
      .eval(script, [`inventory:admit:v1:${input.storeId}:${productVariantId}`], [
        INVENTORY_ADMISSION_LIMIT,
        INVENTORY_ADMISSION_WINDOW_SECONDS
      ])
      .catch(() => 1);
      if (Number(admitted) === 0) {
        throw paymentError(
          HttpStatus.TOO_MANY_REQUESTS,
          "INVENTORY_BUSY",
          "Inventory is busy for this item. Please retry shortly.",
          true,
          { productVariantId, retryAfterMs: 2_000 },
          2
        );
      }
    }));
  }

  async evictPublicStockCache(storeId: string, productVariantIds: string[]) {
    const variants = Array.from(new Set(productVariantIds));
    await Promise.all(
      variants
      .map((productVariantId) =>
        this.redis.del(`inventory:public:v1:${storeId}:${productVariantId}`).catch(() => undefined)
      )
    );
    if (variants.length) {
      await this.shops.invalidateStockSensitiveCaches({
        operation: "inventory_stock_changed",
        productVariantIds: variants,
        storeId
      });
    }
  }

  async initializeCatalogInventory(tx: Tx, input: InitializeCatalogInventoryInput) {
    const variants = input.variants
      .map((variant) => ({
        productVariantId: variant.productVariantId,
        availableStock: Math.max(variant.availableStock, 0)
      }))
      .sort((a, b) => a.productVariantId.localeCompare(b.productVariantId));
    assertLockBudget(variants.length);
    if (!variants.length) {
      return { initialized: 0 };
    }
    await this.configureTx(tx, input.storeId);
    const location = await this.ensureDefaultLocation(tx, input.storeId);
    const rows = await tx.$queryRaw<Array<{ initialized: number }>>(Prisma.sql`
      WITH
      variant_input AS (
        SELECT *
        FROM jsonb_to_recordset(${JSON.stringify(variants)}::jsonb) AS variant(
          "productVariantId" uuid,
          "availableStock" integer
        )
      ),
      insert_items AS (
        INSERT INTO inventory_items (
          store_id,
          product_variant_id,
          location_id,
          available_stock,
          reserved_stock,
          sold_stock,
          version,
          created_at,
          updated_at
        )
        SELECT
          ${input.storeId}::uuid,
          variant."productVariantId",
          ${location.id}::uuid,
          GREATEST(variant."availableStock", 0),
          0,
          0,
          1,
          now(),
          now()
        FROM variant_input variant
        ON CONFLICT (store_id, product_variant_id, location_id) DO NOTHING
        RETURNING id
      ),
      initialized_items AS (
        SELECT
          item.id,
          item.store_id,
          item.product_variant_id,
          item.location_id,
          item.available_stock,
          (${input.idempotencyKey} || ':' || item.product_variant_id::text) AS ledger_key
        FROM inventory_items item
        JOIN variant_input variant ON variant."productVariantId" = item.product_variant_id
        WHERE item.store_id = ${input.storeId}::uuid
          AND item.location_id = ${location.id}::uuid
          AND item.available_stock > 0
          AND NOT EXISTS (
            SELECT 1
            FROM inventory_ledger existing_ledger
            WHERE existing_ledger.idempotency_key = (${input.idempotencyKey} || ':' || item.product_variant_id::text)
          )
      ),
      insert_ledger AS (
        INSERT INTO inventory_ledger (
          schema_version,
          store_id,
          product_variant_id,
          location_id,
          type,
          quantity,
          before_available_stock,
          after_available_stock,
          before_reserved_stock,
          after_reserved_stock,
          before_sold_stock,
          after_sold_stock,
          actor_type,
          reason,
          idempotency_key,
          created_at
        )
        SELECT
          1,
          item.store_id,
          item.product_variant_id,
          item.location_id,
          ${InventoryLedgerType.MANUAL_ADJUSTMENT}::"InventoryLedgerType",
          GREATEST(item.available_stock, 1),
          0,
          item.available_stock,
          0,
          0,
          0,
          0,
          'SYSTEM',
          ${input.reason},
          item.ledger_key,
          now()
        FROM initialized_items item
        RETURNING product_variant_id
      ),
      insert_events AS (
        INSERT INTO domain_events (
          schema_version,
          event_type,
          aggregate_type,
          aggregate_id,
          idempotency_key,
          producer,
          status,
          payload,
          occurred_at,
          next_run_at,
          created_at,
          updated_at
        )
        SELECT
          1,
          'inventory.initialized.v1',
          'inventory',
          item.id,
          item.ledger_key,
          'lotzi-api',
          ${DomainEventStatus.PENDING}::"DomainEventStatus",
          jsonb_build_object(
            'eventId', item.ledger_key,
            'eventType', 'inventory.initialized.v1',
            'schemaVersion', 1,
            'aggregateType', 'inventory',
            'aggregateId', item.id,
            'storeId', item.store_id,
            'idempotencyKey', item.ledger_key,
            'occurredAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'producer', 'lotzi-api',
            'traceId', ${input.requestId ?? null}::text,
            'payload', jsonb_build_object(
              'productVariantId', item.product_variant_id,
              'locationId', item.location_id,
              'availableStock', item.available_stock
            )
          ),
          now(),
          now(),
          now(),
          now()
        FROM initialized_items item
        JOIN insert_ledger ledger ON ledger.product_variant_id = item.product_variant_id
        RETURNING id
      )
      SELECT COALESCE((SELECT COUNT(*)::integer FROM insert_ledger), 0) AS initialized
    `);
    return { initialized: rows[0]?.initialized ?? 0 };
  }

  async reserveOrderStock(tx: Tx, input: ReserveOrderStockInput) {
    const items = aggregateItems(input.items);
    assertLockBudget(items.length);
    await this.configureTx(tx, input.storeId);

    const operation = await this.claimOperation(tx, {
      operationKey: `inventory.reserve:${input.orderId}`,
      operationType: "inventory.reserve_order.v1",
      aggregateId: input.orderId,
      requestHash: this.hash({ storeId: input.storeId, orderId: input.orderId, items })
    });
    if (operation.state === "replayed") {
      return operation.response;
    }

    const location = await this.ensureDefaultLocation(tx, input.storeId);
    const inventoryItems = await this.ensureInventoryItems(
      tx,
      input.storeId,
      location.id,
      items.map((item) => item.productVariantId)
    );
    const locked = await this.lockInventoryItems(tx, inventoryItems.map((item) => item.id));
    const byVariant = new Map(locked.map((item) => [item.productVariantId, item]));
    const reservations: Array<{ id: string; productVariantId: string; locationId: string; quantity: number }> = [];

    for (const item of items) {
      const row = byVariant.get(item.productVariantId);
      if (!row || row.availableStock < item.quantity) {
        throw paymentError(HttpStatus.CONFLICT, "CHECKOUT_OUT_OF_STOCK", "One or more items are out of stock.", false, {
          variantId: item.productVariantId,
          available: row?.availableStock ?? 0
        });
      }

      const after = {
        availableStock: row.availableStock - item.quantity,
        reservedStock: row.reservedStock + item.quantity,
        soldStock: row.soldStock,
        version: row.version + 1
      };
      const reservation = await tx.inventoryReservation.create({
        data: {
          storeId: input.storeId,
          orderId: input.orderId,
          productVariantId: item.productVariantId,
          locationId: row.locationId,
          quantity: item.quantity,
          status: InventoryReservationStatus.ACTIVE,
          expiresAt: input.expiresAt
        },
        select: { id: true, productVariantId: true, locationId: true, quantity: true }
      });
      await this.updateInventoryItem(tx, row, after);
      await this.createLedger(tx, {
        row,
        after,
        type: InventoryLedgerType.RESERVED,
        quantity: item.quantity,
        orderId: input.orderId,
        reservationId: reservation.id,
        actorType: "CUSTOMER",
        actorUserId: input.userId,
        reason: "checkout_reserved",
        idempotencyKey: input.idempotencyKey
      });
      await this.emitInventoryEvent(tx, {
        eventType: "inventory.reserved.v1",
        aggregateId: row.id,
        storeId: input.storeId,
        idempotencyKey: `${input.idempotencyKey}:reserved:${reservation.id}`,
        requestId: input.requestId,
        payload: {
          orderId: input.orderId,
          reservationId: reservation.id,
          productVariantId: item.productVariantId,
          locationId: row.locationId,
          quantity: item.quantity
        }
      });
      await this.emitLowStockIfNeeded(tx, row, after, input.requestId);
      reservations.push(reservation);
    }

    const response = { status: "RESERVED", reservations };
    await this.completeOperation(tx, operation.operationKey, response);
    return response;
  }

  async authorizeCodOrderStock(tx: Tx, input: AuthorizeCodOrderStockInput) {
    const items = aggregateItems(input.items);
    assertLockBudget(items.length);
    await this.configureTx(tx, input.storeId);

    const operation = await this.claimOperation(tx, {
      operationKey: `inventory.cod_authorize:${input.orderId}`,
      operationType: "inventory.cod_authorize_order.v1",
      aggregateId: input.orderId,
      requestHash: this.hash({ storeId: input.storeId, orderId: input.orderId, items })
    });
    if (operation.state === "replayed") {
      return operation.response as { status: string; reservations?: unknown[] };
    }

    const location = await this.ensureDefaultLocation(tx, input.storeId);
    const inventoryItems = await this.ensureInventoryItems(
      tx,
      input.storeId,
      location.id,
      items.map((item) => item.productVariantId)
    );
    const locked = await this.lockInventoryItems(tx, inventoryItems.map((item) => item.id));
    const byVariant = new Map(locked.map((item) => [item.productVariantId, item]));
    const reservations: Array<{ id: string; productVariantId: string; locationId: string; quantity: number }> = [];

    for (const item of items) {
      const row = byVariant.get(item.productVariantId);
      if (!row || row.availableStock < item.quantity) {
        throw paymentError(HttpStatus.CONFLICT, "CHECKOUT_OUT_OF_STOCK", "One or more items are out of stock.", false, {
          variantId: item.productVariantId,
          available: row?.availableStock ?? 0
        });
      }

      const after = {
        availableStock: row.availableStock - item.quantity,
        reservedStock: row.reservedStock,
        soldStock: row.soldStock + item.quantity,
        version: row.version + 1
      };
      const reservation = await tx.inventoryReservation.create({
        data: {
          storeId: input.storeId,
          orderId: input.orderId,
          productVariantId: item.productVariantId,
          locationId: row.locationId,
          quantity: item.quantity,
          status: InventoryReservationStatus.CONFIRMED,
          expiresAt: input.expiresAt,
          confirmedAt: new Date()
        },
        select: { id: true, productVariantId: true, locationId: true, quantity: true }
      });
      await this.updateInventoryItem(tx, row, after);
      await this.createLedger(tx, {
        row,
        after,
        type: InventoryLedgerType.SOLD,
        quantity: item.quantity,
        orderId: input.orderId,
        reservationId: reservation.id,
        actorType: "CUSTOMER",
        actorUserId: input.userId,
        reason: "cod_order_authorized",
        idempotencyKey: input.idempotencyKey
      });
      await this.emitInventoryEvent(tx, {
        eventType: "inventory.confirmed.v1",
        aggregateId: row.id,
        storeId: input.storeId,
        idempotencyKey: `${input.idempotencyKey}:cod-confirmed:${reservation.id}`,
        requestId: input.requestId,
        payload: {
          orderId: input.orderId,
          reservationId: reservation.id,
          productVariantId: item.productVariantId,
          locationId: row.locationId,
          quantity: item.quantity
        }
      });
      await this.emitLowStockIfNeeded(tx, row, after, input.requestId);
      reservations.push(reservation);
    }

    const response = { status: "CONFIRMED", reservations };
    await this.completeOperation(tx, operation.operationKey, response);
    return response;
  }

  async confirmOrderStock(tx: Tx, input: ConfirmOrderStockInput) {
    await this.configureTx(tx, input.storeId);
    const operation = await this.claimOperation(tx, {
      operationKey: `inventory.confirm:${input.orderId}`,
      operationType: "inventory.confirm_order.v1",
      aggregateId: input.orderId,
      requestHash: this.hash({ storeId: input.storeId, orderId: input.orderId })
    });
    if (operation.state === "replayed") {
      return operation.response as { status: string; reason?: string };
    }

    const reservations = await tx.$queryRaw<LockedReservation[]>(Prisma.sql`
      SELECT
        id,
        store_id AS "storeId",
        order_id AS "orderId",
        product_variant_id AS "productVariantId",
        location_id AS "locationId",
        quantity,
        status,
        expires_at AS "expiresAt"
      FROM inventory_reservations
      WHERE store_id = ${input.storeId}::uuid
        AND order_id = ${input.orderId}::uuid
      ORDER BY product_variant_id, location_id
      FOR UPDATE
    `);
    if (!reservations.length) {
      const response = { status: "REQUIRES_REVIEW", reason: "reservation_missing" };
      await this.completeOperation(tx, operation.operationKey, response);
      return response;
    }
    if (reservations.every((reservation) => reservation.status === InventoryReservationStatus.CONFIRMED)) {
      const response = { status: "ALREADY_CONFIRMED" };
      await this.completeOperation(tx, operation.operationKey, response);
      return response;
    }
    const inactive = reservations.filter((reservation) => reservation.status !== InventoryReservationStatus.ACTIVE);
    if (inactive.length > 0) {
      const response = {
        status: "REQUIRES_REVIEW",
        reason: "reservation_not_active",
        reservations: inactive.map((reservation) => ({ id: reservation.id, status: reservation.status }))
      };
      await this.completeOperation(tx, operation.operationKey, response);
      await this.emitInventoryEvent(tx, {
        eventType: "inventory.confirmation_requires_review.v1",
        aggregateId: input.orderId,
        storeId: input.storeId,
        idempotencyKey: `${input.idempotencyKey}:inventory-review`,
        requestId: input.requestId,
        payload: response
      });
      return response;
    }

    const locked = await this.lockInventoryItemsForReservations(tx, reservations);
    const byKey = new Map(locked.map((item) => [inventoryKey(item.productVariantId, item.locationId), item]));

    for (const reservation of reservations) {
      const row = byKey.get(inventoryKey(reservation.productVariantId, reservation.locationId));
      if (!row || row.reservedStock < reservation.quantity) {
        const response = { status: "REQUIRES_REVIEW", reason: "reserved_counter_underflow", reservationId: reservation.id };
        await this.completeOperation(tx, operation.operationKey, response);
        return response;
      }

      const after = {
        availableStock: row.availableStock,
        reservedStock: row.reservedStock - reservation.quantity,
        soldStock: row.soldStock + reservation.quantity,
        version: row.version + 1
      };
      await this.updateInventoryItem(tx, row, after);
      await tx.inventoryReservation.update({
        where: { id: reservation.id },
        data: { status: InventoryReservationStatus.CONFIRMED, confirmedAt: new Date() }
      });
      await this.createLedger(tx, {
        row,
        after,
        type: InventoryLedgerType.SOLD,
        quantity: reservation.quantity,
        orderId: input.orderId,
        reservationId: reservation.id,
        actorType: "SYSTEM",
        reason: "payment_confirmed",
        idempotencyKey: input.idempotencyKey
      });
      await this.emitInventoryEvent(tx, {
        eventType: "inventory.confirmed.v1",
        aggregateId: row.id,
        storeId: input.storeId,
        idempotencyKey: `${input.idempotencyKey}:confirmed:${reservation.id}`,
        requestId: input.requestId,
        payload: {
          orderId: input.orderId,
          reservationId: reservation.id,
          productVariantId: reservation.productVariantId,
          locationId: reservation.locationId,
          quantity: reservation.quantity
        }
      });
    }

    const response = { status: "CONFIRMED" };
    await this.completeOperation(tx, operation.operationKey, response);
    return response;
  }

  async releaseOrderStock(tx: Tx, input: ReleaseOrderStockInput) {
    await this.configureTx(tx, input.storeId);
    const targetStatus = input.status ?? InventoryReservationStatus.RELEASED;
    const operation = await this.claimOperation(tx, {
      operationKey: `inventory.release:${input.orderId}:${targetStatus}:${input.reason}`,
      operationType: "inventory.release_order.v1",
      aggregateId: input.orderId,
      requestHash: this.hash({ storeId: input.storeId, orderId: input.orderId, targetStatus, reason: input.reason })
    });
    if (operation.state === "replayed") {
      return operation.response;
    }

    const reservations = await tx.$queryRaw<LockedReservation[]>(Prisma.sql`
      SELECT
        id,
        store_id AS "storeId",
        order_id AS "orderId",
        product_variant_id AS "productVariantId",
        location_id AS "locationId",
        quantity,
        status,
        expires_at AS "expiresAt"
      FROM inventory_reservations
      WHERE store_id = ${input.storeId}::uuid
        AND order_id = ${input.orderId}::uuid
        AND status = ${InventoryReservationStatus.ACTIVE}::"InventoryReservationStatus"
      ORDER BY product_variant_id, location_id
      FOR UPDATE
    `);
    if (!reservations.length) {
      const response = { status: "NO_ACTIVE_RESERVATIONS", released: 0 };
      await this.completeOperation(tx, operation.operationKey, response);
      return response;
    }

    const released = await this.releaseReservations(tx, reservations, {
      status: targetStatus,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
      actorType: input.actorType ?? "SYSTEM",
      actorUserId: input.actorUserId,
      requestId: input.requestId
    });
    const response = { status: targetStatus, released };
    await this.completeOperation(tx, operation.operationKey, response);
    return response;
  }

  async expireReservations(limit = 100) {
    const rows = await this.prisma.$transaction(async (tx) => {
      await this.configurePlatformTx(tx);
      const reservations = await tx.$queryRaw<LockedReservation[]>(Prisma.sql`
        SELECT
          id,
          store_id AS "storeId",
          order_id AS "orderId",
          product_variant_id AS "productVariantId",
          location_id AS "locationId",
          quantity,
          status,
          expires_at AS "expiresAt"
        FROM inventory_reservations
        WHERE status = ${InventoryReservationStatus.ACTIVE}::"InventoryReservationStatus"
          AND expires_at < now()
        ORDER BY expires_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `);
      let expired = 0;
      for (const reservation of reservations) {
        expired += await this.releaseReservations(tx, [reservation], {
          status: InventoryReservationStatus.EXPIRED,
          reason: "reservation_ttl_expired",
          idempotencyKey: `reservation-expiry:${reservation.id}`,
          actorType: "SYSTEM"
        });
      }
      return { expired };
    });
    return rows;
  }

  async applyManualAdjustment(input: InventoryAdjustmentDto & { actorUserId: string; requestId?: string }) {
    return this.prisma.$transaction(async (tx) => {
      await this.configureTx(tx, input.storeId);
      const location = input.locationId
        ? { id: input.locationId }
        : await this.ensureDefaultLocation(tx, input.storeId);
      const [item] = await this.ensureInventoryItems(tx, input.storeId, location.id, [input.productVariantId]);
      const [locked] = await this.lockInventoryItems(tx, [item.id]);
      if (!locked) {
        throw paymentError(HttpStatus.NOT_FOUND, "INVENTORY_ITEM_NOT_FOUND", "Inventory item not found.");
      }
      if (locked.version !== input.expectedVersion) {
        await tx.auditLog.create({
          data: {
            eventType: "inventory.manual_adjustment.version_conflict",
            actor: "MERCHANT",
            actorUserId: input.actorUserId,
            storeId: input.storeId,
            outcome: "DENIED",
            requestId: input.requestId,
            metadata: {
              productVariantId: input.productVariantId,
              expectedVersion: input.expectedVersion,
              currentVersion: locked.version
            } as Prisma.InputJsonValue
          }
        });
        throw paymentError(
          HttpStatus.CONFLICT,
          "INVENTORY_VERSION_CONFLICT",
          "Inventory changed before this adjustment could be applied. Reload and try again.",
          false,
          { expectedVersion: input.expectedVersion, currentVersion: locked.version }
        );
      }
      const nextAvailable = locked.availableStock + input.deltaAvailableStock;
      if (nextAvailable < 0) {
        throw paymentError(HttpStatus.BAD_REQUEST, "INVENTORY_ADJUSTMENT_INVALID", "Adjustment would make available stock negative.");
      }
      const operation = await this.claimOperation(tx, {
        operationKey: `inventory.adjust:${input.idempotencyKey}`,
        operationType: "inventory.manual_adjustment.v1",
        aggregateId: locked.id,
        requestHash: this.hash({
          storeId: input.storeId,
          productVariantId: input.productVariantId,
          locationId: location.id,
          deltaAvailableStock: input.deltaAvailableStock,
          expectedVersion: input.expectedVersion,
          reason: input.reason
        })
      });
      if (operation.state === "replayed") {
        return operation.response;
      }
      const after = {
        availableStock: nextAvailable,
        reservedStock: locked.reservedStock,
        soldStock: locked.soldStock,
        version: locked.version + 1
      };
      await this.updateInventoryItem(tx, locked, after);
      await this.createLedger(tx, {
        row: locked,
        after,
        type: InventoryLedgerType.MANUAL_ADJUSTMENT,
        quantity: Math.abs(input.deltaAvailableStock) || 1,
        actorType: "MERCHANT",
        actorUserId: input.actorUserId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey
      });
      await this.emitLowStockIfNeeded(tx, locked, after, input.requestId);
      const response = { apiVersion: "v1", status: "APPLIED", inventoryItemId: locked.id, version: after.version };
      await this.completeOperation(tx, operation.operationKey, response);
      return response;
    });
  }

  async reconcile(dto: InventoryReconcileDto, context: { actor: string; actorUserId?: string; requestId?: string }) {
    const dryRun = dto.dryRun !== false;
    const chunkSize = dto.chunkSize ?? 500;
    return this.prisma.$transaction(async (tx) => {
      await this.configureTx(tx, dto.storeId);
      const location = dto.locationId
        ? { id: dto.locationId }
        : await this.ensureDefaultLocation(tx, dto.storeId);
      const lockRows = await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
        SELECT pg_try_advisory_xact_lock(hashtext(${dto.storeId}), hashtext(${location.id})) AS locked
      `);
      if (!lockRows[0]?.locked) {
        throw paymentError(HttpStatus.CONFLICT, "INVENTORY_RECONCILE_BUSY", "Inventory reconciliation is already running for this location.", true, undefined, 30);
      }
      const items = await tx.inventoryItem.findMany({
        where: {
          storeId: dto.storeId,
          locationId: location.id,
          ...(dto.productVariantId ? { productVariantId: dto.productVariantId } : {})
        },
        orderBy: [{ productVariantId: "asc" }],
        take: chunkSize
      });
      const diffs = [];
      for (const item of items) {
        const ledger = await tx.inventoryLedger.findMany({
          where: {
            storeId: item.storeId,
            productVariantId: item.productVariantId,
            locationId: item.locationId
          },
          orderBy: { createdAt: "asc" },
          select: {
            afterAvailableStock: true,
            afterReservedStock: true,
            afterSoldStock: true,
            createdAt: true
          },
          take: 1_000
        });
        const last = ledger[ledger.length - 1];
        const expected = last
          ? {
              availableStock: last.afterAvailableStock,
              reservedStock: last.afterReservedStock,
              soldStock: last.afterSoldStock
            }
          : { availableStock: 0, reservedStock: 0, soldStock: 0 };
        if (
          expected.availableStock !== item.availableStock ||
          expected.reservedStock !== item.reservedStock ||
          expected.soldStock !== item.soldStock
        ) {
          diffs.push({
            inventoryItemId: item.id,
            productVariantId: item.productVariantId,
            locationId: item.locationId,
            stored: {
              availableStock: item.availableStock,
              reservedStock: item.reservedStock,
              soldStock: item.soldStock
            },
            expected
          });
        }
      }
      await tx.auditLog.create({
        data: {
          eventType: dryRun ? "inventory.reconcile.dry_run" : "inventory.reconcile.apply",
          actor: context.actor,
          actorUserId: context.actorUserId,
          storeId: dto.storeId,
          outcome: dryRun ? "PENDING" : "SUCCESS",
          requestId: context.requestId,
          metadata: { dryRun, diffCount: diffs.length, chunkSize } as Prisma.InputJsonValue
        }
      });
      return { apiVersion: "v1", dryRun, diffCount: diffs.length, diffs };
    }, { timeout: 30_000 });
  }

  async listStoreInventory(storeId: string, productVariantId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.configureTx(tx, storeId);
      const items = await tx.inventoryItem.findMany({
        where: { storeId, ...(productVariantId ? { productVariantId } : {}) },
        include: { location: true, variant: { include: { product: true } } },
        orderBy: [{ updatedAt: "desc" }],
        take: 250
      });
      return { apiVersion: "v1", items };
    });
  }

  async listReservations(storeId: string, orderId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.configureTx(tx, storeId);
      const reservations = await tx.inventoryReservation.findMany({
        where: { storeId, ...(orderId ? { orderId } : {}) },
        orderBy: [{ createdAt: "desc" }],
        take: 250
      });
      return { apiVersion: "v1", reservations };
    });
  }

  async listLedger(storeId: string, filters: { productVariantId?: string; orderId?: string }) {
    return this.prisma.$transaction(async (tx) => {
      await this.configureTx(tx, storeId);
      const entries = await tx.inventoryLedger.findMany({
        where: {
          storeId,
          ...(filters.productVariantId ? { productVariantId: filters.productVariantId } : {}),
          ...(filters.orderId ? { orderId: filters.orderId } : {})
        },
        orderBy: [{ createdAt: "desc" }],
        take: 250
      });
      return { apiVersion: "v1", entries };
    });
  }

  private async releaseReservations(
    tx: Tx,
    reservations: ReservationForRelease[],
    input: {
      status: InventoryReservationStatus;
      reason: string;
      idempotencyKey: string;
      actorType: string;
      actorUserId?: string;
      requestId?: string;
    }
  ) {
    const locked = await this.lockInventoryItemsForReservations(tx, reservations);
    const byKey = new Map(locked.map((item) => [inventoryKey(item.productVariantId, item.locationId), item]));
    let released = 0;
    for (const reservation of reservations) {
      const row = byKey.get(inventoryKey(reservation.productVariantId, reservation.locationId));
      if (!row || row.reservedStock < reservation.quantity) {
        throw paymentError(HttpStatus.CONFLICT, "INVENTORY_RELEASE_FAILED", "Reserved inventory is inconsistent.", false, {
          reservationId: reservation.id
        });
      }
      const after = {
        availableStock: row.availableStock + reservation.quantity,
        reservedStock: row.reservedStock - reservation.quantity,
        soldStock: row.soldStock,
        version: row.version + 1
      };
      await this.updateInventoryItem(tx, row, after);
      await tx.inventoryReservation.update({
        where: { id: reservation.id },
        data: { status: input.status, reason: input.reason, releasedAt: new Date() }
      });
      await this.createLedger(tx, {
        row,
        after,
        type: InventoryLedgerType.RELEASED,
        quantity: reservation.quantity,
        orderId: reservation.orderId,
        reservationId: reservation.id,
        actorType: input.actorType,
        actorUserId: input.actorUserId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey
      });
      await this.emitInventoryEvent(tx, {
        eventType: input.status === InventoryReservationStatus.EXPIRED ? "inventory.expired.v1" : "inventory.released.v1",
        aggregateId: row.id,
        storeId: row.storeId,
        idempotencyKey: `${input.idempotencyKey}:${reservation.id}`,
        requestId: input.requestId,
        payload: {
          orderId: reservation.orderId,
          reservationId: reservation.id,
          productVariantId: reservation.productVariantId,
          locationId: reservation.locationId,
          quantity: reservation.quantity,
          reason: input.reason
        }
      });
      released += 1;
    }
    return released;
  }

  private async configureTx(tx: Tx, storeId: string) {
    await tx.$queryRaw`
      SELECT
        set_config('lock_timeout', '2s', true),
        set_config('app.current_store_id', ${storeId}, true),
        set_config('app.is_platform_admin', 'false', true)
    `;
  }

  private async configurePlatformTx(tx: Tx) {
    await tx.$queryRaw`
      SELECT
        set_config('lock_timeout', '2s', true),
        set_config('app.current_store_id', '', true),
        set_config('app.is_platform_admin', 'true', true)
    `;
  }

  private async ensureDefaultLocation(tx: Tx, storeId: string) {
    const cached = getCached(this.defaultLocationCache, storeId);
    if (cached) {
      return cached;
    }
    const existing = await tx.inventoryLocation.findFirst({
      where: { storeId, isDefault: true },
      select: { id: true }
    });
    if (existing) {
      setCached(this.defaultLocationCache, storeId, existing, DEFAULT_LOCATION_CACHE_TTL_MS);
      return existing;
    }
    await tx.inventoryLocation.createMany({
      data: {
        storeId,
        name: "Default location",
        type: "STORE",
        isDefault: true
      },
      skipDuplicates: true
    });
    const created = await tx.inventoryLocation.findFirstOrThrow({
      where: { storeId, isDefault: true },
      select: { id: true }
    });
    setCached(this.defaultLocationCache, storeId, created, DEFAULT_LOCATION_CACHE_TTL_MS);
    return created;
  }

  private async ensureInventoryItems(tx: Tx, storeId: string, locationId: string, productVariantIds: string[]) {
    const existing = await tx.inventoryItem.findMany({
      where: { storeId, locationId, productVariantId: { in: productVariantIds } }
    });
    const existingIds = new Set(existing.map((item) => item.productVariantId));
    const missingIds = productVariantIds.filter((id) => !existingIds.has(id));
    if (missingIds.length) {
      const variants = await tx.productVariant.findMany({
        where: { id: { in: missingIds }, product: { storeId } },
        select: {
          id: true,
          stockOnHand: true,
          stockReserved: true,
          stockVersion: true
        }
      });
      if (variants.length !== missingIds.length) {
        throw paymentError(HttpStatus.CONFLICT, "CHECKOUT_PRODUCT_UNAVAILABLE", "One or more products are no longer available.");
      }
      await tx.inventoryItem.createMany({
        data: variants.map((variant) => ({
          storeId,
          productVariantId: variant.id,
          locationId,
          availableStock: Math.max(variant.stockOnHand - variant.stockReserved, 0),
          reservedStock: Math.max(variant.stockReserved, 0),
          soldStock: 0,
          version: Math.max(variant.stockVersion, 1)
        })),
        skipDuplicates: true
      });
    }
    const rows = await tx.inventoryItem.findMany({
      where: { storeId, locationId, productVariantId: { in: productVariantIds } }
    });
    if (rows.length !== productVariantIds.length) {
      throw paymentError(HttpStatus.CONFLICT, "INVENTORY_ITEM_MISSING", "Inventory is not initialized for one or more items.");
    }
    return rows.sort((a, b) => a.productVariantId.localeCompare(b.productVariantId));
  }

  private async lockInventoryItemsForReservations(
    tx: Tx,
    reservations: Array<Pick<LockedReservation, "storeId" | "productVariantId" | "locationId">>
  ) {
    const unique = new Map<string, { storeId: string; productVariantId: string; locationId: string }>();
    for (const reservation of reservations) {
      unique.set(inventoryKey(reservation.productVariantId, reservation.locationId), {
        storeId: reservation.storeId,
        productVariantId: reservation.productVariantId,
        locationId: reservation.locationId
      });
    }
    const rows = await tx.inventoryItem.findMany({
      where: {
        OR: Array.from(unique.values()).map((item) => ({
          storeId: item.storeId,
          productVariantId: item.productVariantId,
          locationId: item.locationId
        }))
      },
      select: { id: true }
    });
    return this.lockInventoryItems(tx, rows.map((row) => row.id));
  }

  private async lockInventoryItems(tx: Tx, ids: string[]) {
    if (!ids.length) {
      return [];
    }
    const rows = await tx.$queryRaw<LockedInventoryItem[]>(Prisma.sql`
      SELECT
        id,
        store_id AS "storeId",
        product_variant_id AS "productVariantId",
        location_id AS "locationId",
        available_stock AS "availableStock",
        reserved_stock AS "reservedStock",
        sold_stock AS "soldStock",
        low_stock_threshold AS "lowStockThreshold",
        version
      FROM inventory_items
      WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY store_id, location_id, product_variant_id
      FOR UPDATE
    `);
    if (rows.length !== ids.length) {
      throw paymentError(HttpStatus.CONFLICT, "INVENTORY_LOCK_FAILED", "Unable to lock all inventory rows.", true);
    }
    return rows;
  }

  private async updateInventoryItem(
    tx: Tx,
    before: LockedInventoryItem,
    after: { availableStock: number; reservedStock: number; soldStock: number; version: number }
  ) {
    await tx.$executeRaw`
      WITH updated_inventory AS (
        UPDATE inventory_items
        SET
          available_stock = ${after.availableStock},
          reserved_stock = ${after.reservedStock},
          sold_stock = ${after.soldStock},
          version = ${after.version},
          updated_at = now()
        WHERE id = ${before.id}::uuid
        RETURNING product_variant_id
      )
      UPDATE product_variants
      SET
        stock = ${after.availableStock},
        stock_on_hand = ${after.availableStock + after.reservedStock},
        stock_reserved = ${after.reservedStock},
        stock_version = ${after.version},
        updated_at = now()
      WHERE id = (SELECT product_variant_id FROM updated_inventory)
    `;
  }

  private async createLedger(
    tx: Tx,
    input: {
      row: LockedInventoryItem;
      after: { availableStock: number; reservedStock: number; soldStock: number };
      type: InventoryLedgerType;
      quantity: number;
      orderId?: string;
      reservationId?: string;
      actorType: string;
      actorUserId?: string;
      reason: string;
      idempotencyKey?: string;
    }
  ) {
    await tx.inventoryLedger.create({
      data: {
        schemaVersion: 1,
        storeId: input.row.storeId,
        productVariantId: input.row.productVariantId,
        locationId: input.row.locationId,
        orderId: input.orderId,
        reservationId: input.reservationId,
        type: input.type,
        quantity: Math.max(input.quantity, 1),
        beforeAvailableStock: input.row.availableStock,
        afterAvailableStock: input.after.availableStock,
        beforeReservedStock: input.row.reservedStock,
        afterReservedStock: input.after.reservedStock,
        beforeSoldStock: input.row.soldStock,
        afterSoldStock: input.after.soldStock,
        actorType: input.actorType,
        actorUserId: input.actorUserId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey
      }
    });
  }

  private async emitLowStockIfNeeded(
    tx: Tx,
    before: LockedInventoryItem,
    after: { availableStock: number },
    requestId?: string
  ) {
    if (before.lowStockThreshold <= 0 || before.availableStock <= before.lowStockThreshold || after.availableStock > before.lowStockThreshold) {
      return;
    }
    const since = new Date(Date.now() - LOW_STOCK_DEDUPE_MS);
    const existing = await tx.domainEvent.findFirst({
      where: {
        eventType: "inventory.low_stock.v1",
        aggregateId: before.id,
        occurredAt: { gte: since }
      },
      select: { id: true }
    });
    if (existing) {
      return;
    }
    await this.emitInventoryEvent(tx, {
      eventType: "inventory.low_stock.v1",
      aggregateId: before.id,
      storeId: before.storeId,
      idempotencyKey: `low-stock:${before.id}:${new Date().toISOString().slice(0, 10)}`,
      requestId,
      payload: {
        productVariantId: before.productVariantId,
        locationId: before.locationId,
        availableStock: after.availableStock,
        lowStockThreshold: before.lowStockThreshold
      }
    });
  }

  private async emitInventoryEvent(
    tx: Tx,
    input: {
      eventType: string;
      aggregateId: string;
      storeId: string;
      idempotencyKey: string;
      requestId?: string;
      payload: Record<string, unknown>;
    }
  ) {
    await tx.domainEvent.create({
      data: {
        schemaVersion: 1,
        eventType: input.eventType,
        aggregateType: "inventory",
        aggregateId: input.aggregateId,
        idempotencyKey: input.idempotencyKey,
        producer: "lotzi-api",
        status: DomainEventStatus.PENDING,
        payload: {
          eventId: input.idempotencyKey,
          eventType: input.eventType,
          schemaVersion: 1,
          aggregateType: "inventory",
          aggregateId: input.aggregateId,
          storeId: input.storeId,
          idempotencyKey: input.idempotencyKey,
          occurredAt: new Date().toISOString(),
          producer: "lotzi-api",
          traceId: input.requestId ?? null,
          payload: input.payload
        } as Prisma.InputJsonValue
      }
    });
  }

  private async claimOperation(
    tx: Tx,
    input: {
      operationKey: string;
      operationType: string;
      aggregateId: string;
      requestHash: string;
    }
  ): Promise<
    | { state: "reserved"; operationKey: string }
    | { state: "replayed"; response: unknown }
  > {
    const now = new Date();
    const claimedUntil = new Date(now.getTime() + OPERATION_CLAIM_MS);
    const expiresAt = new Date(now.getTime() + OPERATION_TTL_MS);
    try {
      await tx.inventoryOperation.create({
        data: {
          operationKey: input.operationKey,
          operationType: input.operationType,
          aggregateId: input.aggregateId,
          requestHash: input.requestHash,
          status: InventoryOperationStatus.IN_PROGRESS,
          claimedUntil,
          heartbeatAt: now,
          expiresAt
        }
      });
      return { state: "reserved", operationKey: input.operationKey };
    } catch (error) {
      if (!isUniqueConflict(error)) {
        throw error;
      }
    }

    const existing = await tx.inventoryOperation.findUniqueOrThrow({ where: { operationKey: input.operationKey } });
    if (existing.requestHash !== input.requestHash || existing.operationType !== input.operationType) {
      throw paymentError(HttpStatus.CONFLICT, "INVENTORY_OPERATION_KEY_REUSED", "This inventory operation key was used for a different request.");
    }
    if (existing.status === InventoryOperationStatus.COMPLETED) {
      return { state: "replayed", response: existing.responseJson };
    }
    if (existing.status === InventoryOperationStatus.IN_PROGRESS && existing.claimedUntil > now) {
      throw paymentError(HttpStatus.CONFLICT, "INVENTORY_OPERATION_IN_PROGRESS", "This inventory operation is already in progress.", true, undefined, 3);
    }
    const reclaimed = await tx.inventoryOperation.updateMany({
      where: {
        operationKey: input.operationKey,
        OR: [
          { status: InventoryOperationStatus.FAILED },
          { status: InventoryOperationStatus.IN_PROGRESS, claimedUntil: { lte: now } },
          { expiresAt: { lte: now } }
        ]
      },
      data: {
        status: InventoryOperationStatus.IN_PROGRESS,
        claimedUntil,
        heartbeatAt: now,
        expiresAt,
        responseJson: Prisma.JsonNull
      }
    });
    if (reclaimed.count !== 1) {
      throw paymentError(HttpStatus.CONFLICT, "INVENTORY_OPERATION_IN_PROGRESS", "This inventory operation is already in progress.", true, undefined, 3);
    }
    return { state: "reserved", operationKey: input.operationKey };
  }

  private async completeOperation(tx: Tx, operationKey: string, response: unknown) {
    await tx.inventoryOperation.update({
      where: { operationKey },
      data: {
        status: InventoryOperationStatus.COMPLETED,
        responseJson: response as Prisma.InputJsonValue,
        heartbeatAt: new Date()
      }
    });
  }
}

function assertLockBudget(lineCount: number) {
  if (lineCount > MAX_INVENTORY_LOCK_LINES) {
    throw paymentError(
      HttpStatus.BAD_REQUEST,
      "CHECKOUT_CART_TOO_LARGE",
      `Checkout supports up to ${MAX_INVENTORY_LOCK_LINES} distinct items.`,
      false,
      { maxLines: MAX_INVENTORY_LOCK_LINES, lineCount }
    );
  }
}

function aggregateItems(items: Array<{ productVariantId: string; quantity: number }>) {
  const aggregated = new Map<string, { productVariantId: string; quantity: number }>();
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw paymentError(HttpStatus.BAD_REQUEST, "INVENTORY_QUANTITY_INVALID", "Quantity must be a positive whole number.");
    }
    const existing = aggregated.get(item.productVariantId);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      aggregated.set(item.productVariantId, { ...item });
    }
  }
  return Array.from(aggregated.values()).sort((a, b) => a.productVariantId.localeCompare(b.productVariantId));
}

function inventoryKey(productVariantId: string, locationId: string) {
  return `${productVariantId}:${locationId}`;
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
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
