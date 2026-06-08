import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, ProductVariantStatus, StoreStatus } from "@prisma/client";
import { PrismaService } from "@/database/prisma.service";
import { AuthenticatedPrincipal } from "@/modules/auth/auth.types";
import { availableStock, formatPricePerBaseUnitDisplay, formatUnitDisplay } from "@/modules/products/product-measurement";
import { PERMISSIONS } from "@/modules/rbac/permissions";
import { RbacEngine } from "@/modules/rbac/rbac.engine";

const DEFAULT_CATALOG_LIMIT = 80;
const SEARCH_CATALOG_LIMIT = 20;
const MAX_CATALOG_LIMIT = 100;

const posCatalogVariantSelect = {
  id: true,
  productId: true,
  name: true,
  sku: true,
  price: true,
  mrp: true,
  stock: true,
  stockOnHand: true,
  stockReserved: true,
  stockVersion: true,
  unitGroup: true,
  quantityValue: true,
  quantityUnit: true,
  normalizedValue: true,
  normalizedUnit: true,
  packType: true,
  pricePerBaseUnit: true,
  isDefault: true,
  position: true,
  product: {
    select: {
      id: true,
      name: true,
      sku: true,
      categoryId: true,
      imageUrl: true,
      status: true,
      category: {
        select: {
          id: true,
          name: true,
          slug: true
        }
      }
    }
  }
} satisfies Prisma.ProductVariantSelect;

type PosCatalogVariantRow = Prisma.ProductVariantGetPayload<{ select: typeof posCatalogVariantSelect }>;

export interface PosCatalogQuery {
  query?: string;
  limit?: number;
}

export interface PosCatalogResponse {
  apiVersion: "v1";
  source: "database";
  query: string;
  count: number;
  results: PosCatalogItem[];
}

export interface PosCatalogItem {
  id: string;
  productId: string;
  variantId: string;
  name: string;
  variantName: string;
  sku: string | null;
  productSku: string | null;
  price: number;
  mrp: number | null;
  availableStock: number;
  stockOnHand: number;
  stockReserved: number;
  stockVersion: number;
  unitDisplay: string;
  pricePerBaseUnit: number;
  pricePerBaseUnitDisplay: string;
  categoryId: string | null;
  categoryName: string | null;
  imageUrl: string | null;
  product: {
    id: string;
    name: string;
    sku: string | null;
    status: string;
    categoryId: string | null;
    imageUrl: string | null;
  };
}

@Injectable()
export class PosCatalogService {
  private readonly logger = new Logger(PosCatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacEngine
  ) {}

  async syncStoreCatalog(auth: AuthenticatedPrincipal, storeId: string) {
    await this.assertStoreReadAccess(auth, storeId);
    this.logger.log(`Syncing POS catalog for store ${storeId}`);

    const count = await this.prisma.productVariant.count({
      where: this.catalogWhere(storeId)
    });

    this.logger.log(`Synced ${count} products to POS cache for store ${storeId}`);
    return { apiVersion: "v1" as const, success: true, count, source: "database" as const };
  }

  async listProducts(
    auth: AuthenticatedPrincipal,
    storeId: string,
    options: PosCatalogQuery = {}
  ): Promise<PosCatalogResponse> {
    await this.assertStoreReadAccess(auth, storeId);

    const query = normalizeSearchQuery(options.query);
    const limit = clampLimit(options.limit, query ? SEARCH_CATALOG_LIMIT : DEFAULT_CATALOG_LIMIT);

    const results = await this.prisma.productVariant.findMany({
      where: this.catalogWhere(storeId, query),
      select: posCatalogVariantSelect,
      orderBy: [
        { updatedAt: "desc" },
        { isDefault: "desc" },
        { position: "asc" },
        { id: "asc" }
      ],
      take: limit
    });

    return {
      apiVersion: "v1",
      source: "database",
      query,
      count: results.length,
      results: results.map(toCatalogItem)
    };
  }

  async searchProducts(
    auth: AuthenticatedPrincipal,
    storeId: string,
    query: string,
    limit?: number
  ): Promise<PosCatalogResponse> {
    return this.listProducts(auth, storeId, { query, limit });
  }

  private catalogWhere(storeId: string, query = ""): Prisma.ProductVariantWhereInput {
    const where: Prisma.ProductVariantWhereInput = {
      status: ProductVariantStatus.ACTIVE,
      product: {
        storeId,
        isActive: true
      }
    };

    if (!query) {
      return where;
    }

    return {
      ...where,
      OR: [
        { sku: { contains: query, mode: "insensitive" } },
        { name: { contains: query, mode: "insensitive" } },
        { product: { sku: { contains: query, mode: "insensitive" } } },
        { product: { name: { contains: query, mode: "insensitive" } } }
      ]
    };
  }

  private async assertStoreReadAccess(auth: AuthenticatedPrincipal, storeId: string) {
    const authorization = await this.rbac.storeAuthorization(auth.userId, storeId, auth.authzVersion);

    if (authorization.isPlatformAdmin) {
      const store = await this.prisma.store.findFirst({
        where: {
          id: storeId,
          deletedAt: null,
          status: { in: [StoreStatus.APPROVED, StoreStatus.PENDING] }
        },
        select: { id: true }
      });
      if (!store) {
        throw new NotFoundException({
          apiVersion: "v1",
          code: "POS_STORE_NOT_FOUND",
          message: "Store not found."
        });
      }
      return;
    }

    if (
      authorization.storeExists === false ||
      authorization.storeDeletedAt ||
      !authorization.storeStatus ||
      (authorization.storeStatus !== StoreStatus.APPROVED && authorization.storeStatus !== StoreStatus.PENDING)
    ) {
      throw new NotFoundException({
        apiVersion: "v1",
        code: "POS_STORE_NOT_FOUND",
        message: "Store not found."
      });
    }

    if (!this.rbac.hasPermissions(authorization.permissions, [PERMISSIONS.STORE_READ])) {
      throw new ForbiddenException({
        apiVersion: "v1",
        code: "POS_FORBIDDEN",
        message: "Insufficient store permissions."
      });
    }
  }
}

function toCatalogItem(variant: PosCatalogVariantRow): PosCatalogItem {
  const measurement = {
    unitGroup: variant.unitGroup,
    quantityValue: Number(variant.quantityValue),
    quantityUnit: variant.quantityUnit,
    normalizedValue: Number(variant.normalizedValue),
    normalizedUnit: variant.normalizedUnit,
    packType: variant.packType,
    pricePerBaseUnit: Number(variant.pricePerBaseUnit)
  };
  const pricePerBaseUnit = Number(variant.pricePerBaseUnit);

  return {
    id: variant.id,
    productId: variant.productId,
    variantId: variant.id,
    name: displayName(variant.product.name, variant.name),
    variantName: variant.name,
    sku: variant.sku,
    productSku: variant.product.sku,
    price: Number(variant.price),
    mrp: variant.mrp == null ? null : Number(variant.mrp),
    availableStock: availableStock(variant.stockOnHand, variant.stockReserved),
    stockOnHand: variant.stockOnHand,
    stockReserved: variant.stockReserved,
    stockVersion: variant.stockVersion,
    unitDisplay: formatUnitDisplay(measurement),
    pricePerBaseUnit,
    pricePerBaseUnitDisplay: formatPricePerBaseUnitDisplay(pricePerBaseUnit, variant.unitGroup),
    categoryId: variant.product.categoryId,
    categoryName: variant.product.category?.name ?? null,
    imageUrl: variant.product.imageUrl,
    product: {
      id: variant.product.id,
      name: variant.product.name,
      sku: variant.product.sku,
      status: variant.product.status,
      categoryId: variant.product.categoryId,
      imageUrl: variant.product.imageUrl
    }
  };
}

function displayName(productName: string, variantName: string) {
  const normalizedVariant = variantName.trim();
  if (!normalizedVariant || normalizedVariant.toLowerCase() === "default") {
    return productName;
  }
  if (normalizedVariant.toLowerCase() === productName.trim().toLowerCase()) {
    return productName;
  }
  return `${productName} ${normalizedVariant}`;
}

function normalizeSearchQuery(query?: string) {
  return query?.trim().replace(/\s+/g, " ") ?? "";
}

function clampLimit(limit: number | undefined, fallback: number) {
  if (limit === undefined || !Number.isFinite(limit)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_CATALOG_LIMIT);
}
