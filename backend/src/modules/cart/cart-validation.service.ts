import { BadRequestException, Injectable } from "@nestjs/common";
import { ProductStatus, ProductVariantStatus, StoreStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { CartValidationDto } from "./dto/cart-validation.dto";

@Injectable()
export class CartValidationService {
  private readonly inFlight = new Map<string, Promise<CartValidationResponse>>();

  constructor(private readonly prisma: PrismaService) {}

  validate(dto: CartValidationDto): Promise<CartValidationResponse> {
    const items = normalizeItems(dto.items ?? []);
    if (!items.length) {
      throw new BadRequestException("Cart validation requires at least one item.");
    }
    const key = hash({ items, lastSeenCatalogVersion: dto.lastSeenCatalogVersion ?? null });
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }
    const promise = this.loadValidation(items, dto.lastSeenCatalogVersion ?? null);
    this.inFlight.set(key, promise);
    return promise.finally(() => this.inFlight.delete(key));
  }

  private async loadValidation(items: NormalizedLine[], lastSeenCatalogVersion: string | null): Promise<CartValidationResponse> {
    const variantIds = items.map((item) => item.variantId);
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds }, status: ProductVariantStatus.ACTIVE },
      select: {
        id: true,
        name: true,
        price: true,
        mrp: true,
        stock: true,
        stockOnHand: true,
        stockReserved: true,
        stockVersion: true,
        productId: true,
        product: {
          select: {
            id: true,
            name: true,
            catalogVersion: true,
            imageUrl: true,
            isActive: true,
            status: true,
            storeId: true,
            store: {
              select: {
                id: true,
                name: true,
                status: true,
                deletedAt: true
              }
            }
          }
        },
        inventoryItems: {
          select: {
            availableStock: true,
            reservedStock: true,
            version: true
          }
        }
      }
    });
    const byVariant = new Map(variants.map((variant) => [variant.id, variant]));
    const lines = items.map((item) => {
      const variant = byVariant.get(item.variantId);
      if (!variant || variant.productId !== item.productId) {
        return unavailableLine(item, "VARIANT_UNAVAILABLE");
      }
      const storeAvailable = variant.product.store.status === StoreStatus.APPROVED && !variant.product.store.deletedAt;
      const productAvailable = variant.product.isActive && variant.product.status === ProductStatus.PUBLISHED;
      const availableStock = variant.inventoryItems.length
        ? variant.inventoryItems.reduce((total, row) => total + Math.max(row.availableStock, 0), 0)
        : Math.max(variant.stockOnHand - variant.stockReserved, variant.stock, 0);
      const stockVersion = Math.max(
        variant.stockVersion,
        ...variant.inventoryItems.map((row) => row.version)
      );
      const isAvailable = storeAvailable && productAvailable && availableStock >= item.quantity;
      return {
        productId: item.productId,
        variantId: item.variantId,
        requestedQuantity: item.quantity,
        productName: variant.product.name,
        variantName: variant.name,
        storeId: variant.product.store.id,
        storeName: variant.product.store.name,
        unitPrice: Number(variant.price),
        compareAtPrice: variant.mrp == null ? null : Number(variant.mrp),
        availableStock,
        stockStatus: availableStock > 0 ? "IN_STOCK" as const : "OUT_OF_STOCK" as const,
        isAvailable,
        reason: isAvailable ? null : availabilityReason(storeAvailable, productAvailable, availableStock, item.quantity),
        productVersion: variant.product.catalogVersion,
        stockVersion,
        imageUrl: variant.product.imageUrl
      };
    });
    return {
      apiVersion: "v1",
      validationVersion: hash(lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        productVersion: line.productVersion,
        stockVersion: line.stockVersion,
        unitPrice: line.unitPrice,
        availableStock: line.availableStock,
        isAvailable: line.isAvailable
      }))),
      lastSeenCatalogVersion,
      hasChanges: hasChanges(lines),
      allAvailable: lines.every((line) => line.isAvailable),
      lines
    };
  }
}

interface NormalizedLine {
  productId: string;
  variantId: string;
  quantity: number;
}

export interface CartValidationResponse {
  apiVersion: "v1";
  validationVersion: string;
  lastSeenCatalogVersion: string | null;
  hasChanges: boolean;
  allAvailable: boolean;
  lines: CartValidationLine[];
}

export interface CartValidationLine {
  productId: string;
  variantId: string;
  requestedQuantity: number;
  productName: string | null;
  variantName: string | null;
  storeId: string | null;
  storeName: string | null;
  unitPrice: number;
  compareAtPrice: number | null;
  availableStock: number;
  stockStatus: "IN_STOCK" | "OUT_OF_STOCK";
  isAvailable: boolean;
  reason: string | null;
  productVersion: number;
  stockVersion: number;
  imageUrl: string | null;
}

function normalizeItems(items: CartValidationDto["items"]): NormalizedLine[] {
  const merged = new Map<string, NormalizedLine>();
  for (const item of items) {
    if (!item.variantId) {
      continue;
    }
    const key = `${item.productId}:${item.variantId}`;
    const current = merged.get(key);
    if (current) {
      current.quantity += item.quantity;
    } else {
      merged.set(key, {
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity
      });
    }
  }
  return Array.from(merged.values()).sort((a, b) => `${a.productId}:${a.variantId}`.localeCompare(`${b.productId}:${b.variantId}`));
}

function unavailableLine(item: NormalizedLine, reason: string): CartValidationLine {
  return {
    productId: item.productId,
    variantId: item.variantId,
    requestedQuantity: item.quantity,
    productName: null,
    variantName: null,
    storeId: null,
    storeName: null,
    unitPrice: 0,
    compareAtPrice: null,
    availableStock: 0,
    stockStatus: "OUT_OF_STOCK",
    isAvailable: false,
    reason,
    productVersion: 0,
    stockVersion: 0,
    imageUrl: null
  };
}

function availabilityReason(storeAvailable: boolean, productAvailable: boolean, availableStock: number, requested: number) {
  if (!storeAvailable) return "STORE_UNAVAILABLE";
  if (!productAvailable) return "PRODUCT_UNAVAILABLE";
  if (availableStock <= 0) return "OUT_OF_STOCK";
  if (availableStock < requested) return "INSUFFICIENT_STOCK";
  return "UNAVAILABLE";
}

function hasChanges(lines: CartValidationLine[]) {
  return lines.some((line) => !line.isAvailable);
}

function hash(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
