import { HttpStatus, Injectable } from "@nestjs/common";
import {
  Category as CategoryModel,
  Prisma,
  Product as ProductModel,
  ProductStatus,
  StoreStatus,
  UploadAssetStatus,
  UploadPurpose,
  UploadRenditionKind
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { RequestTimer } from "../../common/request-timing";
import { PrismaService } from "../../database/prisma.service";
import { AuthenticatedPrincipal } from "../auth/auth.types";
import { InventoryService } from "../inventory/inventory.service";
import { PERMISSIONS } from "../rbac/permissions";
import { RbacEngine } from "../rbac/rbac.engine";
import { ShopsService } from "../shops/shops.service";
import { UploadEngineService } from "../uploads/upload-engine.service";
import { uploadError } from "../uploads/uploads.errors";
import {
  CreateProductDto,
  ProductImageInputDto,
  ProductMeasurementInputDto,
  ProductVariantInputDto,
  ReplaceProductImageDto,
  ReorderProductImagesDto,
  UpdateProductDto
} from "./dto/products.dto";
import {
  availableStock,
  formatPricePerBaseUnitDisplay,
  formatUnitDisplay,
  NormalizedMeasurement,
  normalizeProductMeasurement,
  ProductMeasurementError
} from "./product-measurement";

const productInclude = {
  category: true,
  images: {
    include: {
      uploadAsset: { include: { renditions: true } },
      variants: { include: { productVariant: true } }
    },
    orderBy: { sortOrder: "asc" as const }
  },
  variants: {
    orderBy: [
      { isDefault: "desc" as const },
      { position: "asc" as const },
      { createdAt: "asc" as const }
    ]
  }
};

const attachableAssetSelect = {
  id: true,
  originalFilename: true,
  renditions: {
    where: { kind: UploadRenditionKind.CARD },
    select: {
      kind: true,
      secureUrl: true,
      width: true,
      height: true,
      bytes: true,
      format: true
    }
  }
};

const HOT_CACHE_TTL_MS = 30_000;

type AttachableAsset = Prisma.UploadAssetGetPayload<{ select: typeof attachableAssetSelect }>;
type CategoryRef = Pick<CategoryModel, "id" | "name">;
type ProductImageResponseSource = {
  id: string;
  productId: string;
  uploadAssetId: string;
  sortOrder: number;
  isPrimary: boolean;
  altText: string | null;
};
type Decimalish = Prisma.Decimal | number | string;
type ProductVariantResponseSource = {
  id: string;
  name: string;
  sku: string | null;
  price: Decimalish;
  mrp: Decimalish | null;
  costPrice: Decimalish | null;
  pricePerBaseUnit: Decimalish;
  stock: number;
  stockOnHand: number;
  stockReserved: number;
  stockVersion: number;
  unitGroup: ProductModel["unitGroup"];
  quantityValue: Decimalish;
  quantityUnit: ProductModel["quantityUnit"];
  normalizedValue: Decimalish;
  normalizedUnit: ProductModel["normalizedUnit"];
  packType: ProductModel["packType"];
  isDefault: boolean;
  position: number;
};
type ProductImageVariantRow = Prisma.ProductImageVariantCreateManyInput & {
  uploadAssetId: string;
};
type ProductCreateGraphInput = {
  product: {
    id: string;
    storeId: string;
    categoryId: string | null;
    name: string;
    sku: string | null;
    subCategory: string | null;
    productType: string | null;
    description: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
    price: number;
    compareAtPrice: number | null;
    stock: number;
    reorderPoint: number;
    unitGroup: ProductModel["unitGroup"];
    quantityValue: number;
    quantityUnit: ProductModel["quantityUnit"];
    normalizedValue: number;
    normalizedUnit: ProductModel["normalizedUnit"];
    packType: ProductModel["packType"];
    pricePerBaseUnit: number;
    status: ProductStatus;
    primaryUploadAssetId: string | null;
    catalogVersion?: number;
  };
  variantRows: Array<Prisma.ProductVariantCreateManyInput & ProductVariantResponseSource>;
  imageRows: ProductImageResponseSource[];
  imageVariantRows: ProductImageVariantRow[];
};
type ProductCreateGraphRow = {
  assetCount: number;
  product: ProductModel | null;
  assets: AttachableAsset[] | null;
};

@Injectable()
export class ProductsService {
  private readonly categoryCache = new Map<string, CacheEntry<CategoryRef | null>>();
  private readonly storeAccessCache = new Map<string, CacheEntry<true>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly rbac: RbacEngine,
    private readonly shops: ShopsService,
    private readonly uploadEngine: UploadEngineService
  ) {}

  async list(auth: AuthenticatedPrincipal, storeId: string) {
    await this.assertStoreAccess(auth, storeId);
    const products = await this.prisma.product.findMany({
      where: { storeId, isActive: true },
      include: productInclude,
      orderBy: { updatedAt: "desc" }
    });
    return {
      apiVersion: "v1",
      products: products.map(toProductResponse)
    };
  }

  async create(auth: AuthenticatedPrincipal, dto: CreateProductDto, timer?: RequestTimer) {
    await timeStage(timer, "store-access", () => this.assertStoreAccess(auth, dto.storeId));
    const status = toDbStatus(dto.status);
    this.validateProductPrice(dto);
    this.validateImageRules(status, dto.images);
    const productMeasurement = this.normalizeMeasurement(dto.measurement, dto, dto.price);
    const variants = this.normalizedVariants(dto, productMeasurement);
    const images = normalizeImages(dto.images);
    const sku = normalizeOptionalSku(dto.sku);
    const category = await timeStage(timer, "category", () => this.ensureCategory(dto.category));
    const primary = primaryInput(images);
    const productId = randomUUID();
    const variantRows = variants.map((variant) => productVariantCreateData(productId, variant, randomUUID()));
    const variantsBySku = variantsBySkuMap(variantRows);
    const variantsByClientId = variantsByClientIdMap(variants, variantRows);
    assertVariantImageAssignments(images, variantsBySku, variantsByClientId);
    const imageRows = productImageCreateRows(productId, images);
    const imageVariantRows = productImageVariantCreateRows(images, imageRows, variantsBySku, variantsByClientId);

    const result = await timeStage(timer, "db-write", () => this.createProductGraph({
      product: {
        id: productId,
        storeId: dto.storeId,
        categoryId: category?.id ?? null,
        name: dto.name.trim(),
        sku,
        subCategory: normalizeOptionalText(dto.subCategory),
        productType: normalizeOptionalText(dto.productType),
        description: dto.seoDescription?.trim() || null,
        seoTitle: dto.seoTitle?.trim() || null,
        seoDescription: dto.seoDescription?.trim() || null,
        price: dto.price,
        compareAtPrice: toMrp(dto.compareAtPrice),
        stock: dto.stock,
        reorderPoint: dto.reorderPoint,
        unitGroup: productMeasurement.unitGroup,
        quantityValue: productMeasurement.quantityValue,
        quantityUnit: productMeasurement.quantityUnit,
        normalizedValue: productMeasurement.normalizedValue,
        normalizedUnit: productMeasurement.normalizedUnit,
        packType: productMeasurement.packType,
        pricePerBaseUnit: productMeasurement.pricePerBaseUnit,
        status,
        primaryUploadAssetId: primary?.uploadAssetId ?? null
      },
      variantRows,
      imageRows,
      imageVariantRows
    }));
    await timeStage(timer, "inventory-init", () => this.prisma.$transaction((tx) =>
      this.inventory.initializeCatalogInventory(tx, {
        storeId: dto.storeId,
        variants: variantRows.map((variant) => ({
          productVariantId: variant.id,
          availableStock: variant.stock
        })),
        reason: "product_created",
        idempotencyKey: `product-create:${productId}`
      })
    ));
    await timeStage(timer, "public-cache-invalidate", () =>
      this.invalidatePublicShopProductCache(dto.storeId, "product.create")
    );

    return {
      apiVersion: "v1",
      product: timeStageSync(timer, "response-build", () => toWrittenProductResponse({
        product: result.product,
        category,
        images: result.images,
        variants: result.variants,
        assets: result.assets,
        imageVariantsByAssetId: result.imageVariantsByAssetId
      }))
    };
  }

  async update(auth: AuthenticatedPrincipal, productId: string, dto: UpdateProductDto, timer?: RequestTimer) {
    await timeStage(timer, "store-access", () => this.assertStoreAccess(auth, dto.storeId));
    if (isSparseProductUpdate(dto)) {
      return timeStage(timer, "product.patch.sparse.scalar", () => this.updateSparseProduct(productId, dto, timer));
    }

    const fullDto = fullProductUpdateDto(dto);
    const status = toDbStatus(fullDto.status);
    this.validateProductPrice(fullDto);
    this.validateImageRules(status, fullDto.images);
    const productMeasurement = this.normalizeMeasurement(fullDto.measurement, fullDto, fullDto.price);
    const normalizedProductVariants = this.normalizedVariants(fullDto, productMeasurement);
    const images = normalizeImages(fullDto.images);
    const sku = normalizeOptionalSku(fullDto.sku);
    const existing = await timeStage(timer, "existing-product", () => this.prisma.product.findFirst({
      where: { id: productId, storeId: fullDto.storeId },
      include: {
        images: {
          include: {
            uploadAsset: { select: attachableAssetSelect }
          }
        }
      }
    }));
    if (!existing) {
      throw uploadError(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "Product not found.");
    }
    if (fullDto.stock !== existing.stock) {
      throw uploadError(
        HttpStatus.BAD_REQUEST,
        "PRODUCT_STOCK_MANAGED_BY_INVENTORY",
        "Use inventory adjustments to change stock."
      );
    }
    const currentImageAssetIds = new Set(existing.images.map((image) => image.uploadAssetId));
    const incomingAssetIds = new Set(images.map((image) => image.uploadAssetId));
    const newAssets = [...incomingAssetIds].filter((id) => !currentImageAssetIds.has(id));
    const [category, attachableAssets] = await Promise.all([
      timeStage(timer, "category", () => this.ensureCategory(fullDto.category)),
      timeStage(timer, "assets", () =>
        newAssets.length ? this.loadAttachableAssets(fullDto.storeId, newAssets) : Promise.resolve(new Map<string, AttachableAsset>())
      )
    ]);
    const assets = new Map<string, AttachableAsset>([
      ...existing.images.map((image) => [image.uploadAssetId, image.uploadAsset] as const),
      ...attachableAssets
    ]);
    const primary = primaryInput(images);
    const primaryAsset = primary ? assets.get(primary.uploadAssetId) : undefined;
    const primaryCard = primaryAsset?.renditions.find((rendition) => rendition.kind === UploadRenditionKind.CARD);
    const variantRows = normalizedProductVariants.map((variant) => productVariantCreateData(productId, variant, randomUUID()));
    const variantsBySku = variantsBySkuMap(variantRows);
    const variantsByClientId = variantsByClientIdMap(normalizedProductVariants, variantRows);
    assertVariantImageAssignments(images, variantsBySku, variantsByClientId);
    const imageRows = productImageCreateRows(productId, images);

    const result = await timeStage(timer, "db-write", () => this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id: productId },
        data: {
          categoryId: category?.id,
          name: fullDto.name.trim(),
          sku,
          subCategory: normalizeOptionalText(fullDto.subCategory),
          productType: normalizeOptionalText(fullDto.productType),
          description: fullDto.seoDescription?.trim() || null,
          seoTitle: fullDto.seoTitle?.trim() || null,
          seoDescription: fullDto.seoDescription?.trim() || null,
          price: fullDto.price,
          compareAtPrice: toMrp(fullDto.compareAtPrice),
          stock: fullDto.stock,
          reorderPoint: fullDto.reorderPoint,
          unitGroup: productMeasurement.unitGroup,
          quantityValue: productMeasurement.quantityValue,
          quantityUnit: productMeasurement.quantityUnit,
          normalizedValue: productMeasurement.normalizedValue,
          normalizedUnit: productMeasurement.normalizedUnit,
          packType: productMeasurement.packType,
          pricePerBaseUnit: productMeasurement.pricePerBaseUnit,
          status,
          imageUrl: primaryCard?.secureUrl ?? null,
          catalogVersion: { increment: 1 }
        }
      });
      await tx.productImageVariant.deleteMany({
        where: { productImage: { productId } }
      });
      await tx.productImage.deleteMany({ where: { productId } });
      await tx.productVariant.deleteMany({ where: { productId } });
      if (variantRows.length) {
        await tx.productVariant.createMany({ data: variantRows });
        await this.inventory.initializeCatalogInventory(tx, {
          storeId: fullDto.storeId,
          variants: variantRows.map((variant) => ({
            productVariantId: variant.id,
            availableStock: variant.stock
          })),
          reason: "product_updated",
          idempotencyKey: `product-update:${productId}`
        });
      }
      const writtenImages = await this.createProductImages(tx, {
        productId,
        images,
        imageRows,
        variantsBySku,
        variantsByClientId,
        variants: variantRows
      });
      const removed = [...currentImageAssetIds].filter((id) => !incomingAssetIds.has(id));
      if (removed.length) {
        await tx.uploadAsset.updateMany({
          where: { id: { in: removed } },
          data: { status: UploadAssetStatus.ORPHANED, failureReason: "product_image_removed" }
        });
      }
      return { product: updated, variants: variantRows, ...writtenImages };
    }));
    await timeStage(timer, "public-cache-invalidate", () =>
      this.invalidatePublicShopProductCache(fullDto.storeId, "product.update")
    );

    return {
      apiVersion: "v1",
      product: timeStageSync(timer, "response-build", () => toWrittenProductResponse({
        product: result.product,
        category,
        images: result.images,
        variants: result.variants,
        assets,
        imageVariantsByAssetId: result.imageVariantsByAssetId
      }))
    };
  }

  private async updateSparseProduct(productId: string, dto: UpdateProductDto, timer?: RequestTimer) {
    if (dto.expectedCatalogVersion === undefined) {
      throw uploadError(
        HttpStatus.BAD_REQUEST,
        "PRODUCT_VERSION_REQUIRED",
        "expectedCatalogVersion is required for sparse product updates."
      );
    }

    const existing = await timeStage(timer, "occ-check", () => this.prisma.product.findFirst({
      where: { id: productId, storeId: dto.storeId },
      include: {
        category: true,
        variants: {
          where: { isDefault: true },
          take: 1
        }
      }
    }));
    if (!existing) {
      throw uploadError(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "Product not found.");
    }
    if (existing.catalogVersion !== dto.expectedCatalogVersion) {
      if (sparsePatchAlreadyApplied(existing, dto)) {
        return {
          apiVersion: "v1",
          product: sparseProductResponse(existing, existing.category?.name ?? "Grocery", true)
        };
      }
      throw uploadError(
        HttpStatus.CONFLICT,
        "PRODUCT_VERSION_CONFLICT",
        "Product was updated by another session. Reload the latest product before saving again.",
        false,
        {
          expectedCatalogVersion: dto.expectedCatalogVersion,
          currentCatalogVersion: existing.catalogVersion
        }
      );
    }

    const productData: Prisma.ProductUncheckedUpdateManyInput = {};
    const defaultVariantData: Prisma.ProductVariantUpdateManyMutationInput = {};
    const defaultVariant = existing.variants[0];
    let categoryName = existing.category?.name ?? "Grocery";
    let categoryChanged = false;

    if (dto.category !== undefined) {
      const category = await timeStage(timer, "category", () => this.ensureCategory(dto.category ?? ""));
      categoryName = category?.name ?? "Grocery";
      if ((category?.id ?? null) !== existing.categoryId) {
        productData.categoryId = category?.id ?? null;
        categoryChanged = true;
      }
    }

    const nextName = normalizeOptionalText(dto.name);
    if (dto.name !== undefined && !nextName) {
      throw uploadError(HttpStatus.BAD_REQUEST, "PRODUCT_NAME_REQUIRED", "Product name is required.");
    }
    if (dto.name !== undefined && nextName !== existing.name) {
      productData.name = nextName as string;
      defaultVariantData.name = nextName as string;
    }

    const nextSku = dto.sku !== undefined ? normalizeOptionalSku(dto.sku) : existing.sku;
    if (dto.sku !== undefined && nextSku !== existing.sku) {
      productData.sku = nextSku;
      defaultVariantData.sku = nextSku;
    }

    const nextSubCategory = dto.subCategory !== undefined ? normalizeOptionalText(dto.subCategory) : existing.subCategory;
    if (dto.subCategory !== undefined && nextSubCategory !== existing.subCategory) {
      productData.subCategory = nextSubCategory;
    }

    const nextProductType = dto.productType !== undefined ? normalizeOptionalText(dto.productType) : existing.productType;
    if (dto.productType !== undefined && nextProductType !== existing.productType) {
      productData.productType = nextProductType;
    }

    const nextPrice = dto.price ?? Number(existing.price);
    const nextCompareAtPrice = dto.compareAtPrice !== undefined ? toMrp(dto.compareAtPrice) : decimalToNullableNumber(existing.compareAtPrice);
    if ((dto.price !== undefined || dto.compareAtPrice !== undefined) && nextCompareAtPrice !== null && nextCompareAtPrice < nextPrice) {
      throw uploadError(
        HttpStatus.BAD_REQUEST,
        "PRODUCT_PRICE_MRP_BELOW_SELLING_PRICE",
        "Compare-at price must be greater than or equal to the selling price.",
        false,
        { price: nextPrice, compareAtPrice: nextCompareAtPrice }
      );
    }
    if (dto.price !== undefined && nextPrice !== Number(existing.price)) {
      productData.price = nextPrice;
      defaultVariantData.price = nextPrice;
    }
    if (dto.compareAtPrice !== undefined && nextCompareAtPrice !== decimalToNullableNumber(existing.compareAtPrice)) {
      productData.compareAtPrice = nextCompareAtPrice;
      defaultVariantData.mrp = nextCompareAtPrice;
    }

    if (dto.stock !== undefined && dto.stock !== existing.stock) {
      throw uploadError(
        HttpStatus.BAD_REQUEST,
        "PRODUCT_STOCK_MANAGED_BY_INVENTORY",
        "Use inventory adjustments to change stock."
      );
    }

    if (dto.reorderPoint !== undefined && dto.reorderPoint !== existing.reorderPoint) {
      productData.reorderPoint = dto.reorderPoint;
    }

    if (dto.status !== undefined) {
      const status = toDbStatus(dto.status);
      if (status === ProductStatus.PUBLISHED && existing.status !== ProductStatus.PUBLISHED) {
        const imageCount = await timeStage(timer, "image-count", () => this.prisma.productImage.count({ where: { productId } }));
        if (imageCount < 1) {
          throw uploadError(HttpStatus.BAD_REQUEST, "PRODUCT_IMAGES_REQUIRED", "Published products require at least one image.");
        }
      }
      if (status !== existing.status) {
        productData.status = status;
      }
    }

    if (dto.seoTitle !== undefined) {
      const seoTitle = normalizeOptionalText(dto.seoTitle);
      if (seoTitle !== existing.seoTitle) {
        productData.seoTitle = seoTitle;
      }
    }

    if (dto.seoDescription !== undefined) {
      const seoDescription = normalizeOptionalText(dto.seoDescription);
      if (seoDescription !== existing.seoDescription) {
        productData.seoDescription = seoDescription;
        productData.description = seoDescription;
      }
    }

    if (dto.measurement || dto.price !== undefined || categoryChanged || dto.subCategory !== undefined || dto.productType !== undefined) {
      const measurement = this.normalizeMeasurement(
        dto.measurement ?? {
          unitGroup: existing.unitGroup,
          quantityValue: Number(existing.quantityValue),
          quantityUnit: existing.quantityUnit,
          packType: existing.packType
        },
        {
          category: categoryName,
          subCategory: nextSubCategory ?? undefined,
          productType: nextProductType ?? undefined
        },
        nextPrice
      );
      if (!samePersistedMeasurement(existing, measurement) || dto.price !== undefined) {
        productData.unitGroup = measurement.unitGroup;
        productData.quantityValue = measurement.quantityValue;
        productData.quantityUnit = measurement.quantityUnit;
        productData.normalizedValue = measurement.normalizedValue;
        productData.normalizedUnit = measurement.normalizedUnit;
        productData.packType = measurement.packType;
        productData.pricePerBaseUnit = measurement.pricePerBaseUnit;
        defaultVariantData.unitGroup = measurement.unitGroup;
        defaultVariantData.quantityValue = measurement.quantityValue;
        defaultVariantData.quantityUnit = measurement.quantityUnit;
        defaultVariantData.normalizedValue = measurement.normalizedValue;
        defaultVariantData.normalizedUnit = measurement.normalizedUnit;
        defaultVariantData.packType = measurement.packType;
        defaultVariantData.pricePerBaseUnit = measurement.pricePerBaseUnit;
      }
    }

    const productChanged = Object.keys(productData).length > 0;
    const defaultVariantChanged = Object.keys(defaultVariantData).length > 0 && Boolean(defaultVariant);
    if (!productChanged && !defaultVariantChanged) {
      return {
        apiVersion: "v1",
        product: sparseProductResponse(existing, categoryName)
      };
    }

    const updated = await timeStage(timer, "db-update", () => this.prisma.$transaction(async (tx) => {
      const write = productChanged
        ? await tx.product.updateMany({
            where: {
              id: productId,
              storeId: dto.storeId,
              catalogVersion: dto.expectedCatalogVersion
            },
            data: {
              ...productData,
              catalogVersion: { increment: 1 }
            }
          })
        : { count: 1 };
      if (write.count !== 1) {
        throw uploadError(
          HttpStatus.CONFLICT,
          "PRODUCT_VERSION_CONFLICT",
          "Product was updated by another session. Reload the latest product before saving again."
        );
      }
      if (defaultVariantChanged) {
        await timeStage(timer, "default-variant-sync", () => tx.productVariant.updateMany({
          where: { productId, isDefault: true },
          data: defaultVariantData
        }));
      }
      return tx.product.findUniqueOrThrow({
        where: { id: productId },
        include: {
          category: true,
          variants: {
            where: { isDefault: true },
            take: 1
          }
        }
      });
    }));
    await timeStage(timer, "public-cache-invalidate", () =>
      this.invalidatePublicShopProductCache(dto.storeId, "product.patch")
    );

    return {
      apiVersion: "v1",
      product: timeStageSync(timer, "response-build", () =>
        sparseProductResponse(updated, updated.category?.name ?? categoryName)
      )
    };
  }

  async reorderImages(auth: AuthenticatedPrincipal, productId: string, dto: ReorderProductImagesDto) {
    await this.assertProductAccess(auth, productId, dto.storeId);
    this.assertSinglePrimary(dto.images);
    await this.prisma.$transaction(dto.images.map((image) =>
      this.prisma.productImage.updateMany({
        where: {
          productId,
          uploadAssetId: image.uploadAssetId
        },
        data: {
          sortOrder: image.sortOrder,
          isPrimary: image.isPrimary,
          altText: image.altText?.trim() || null
        }
      })
    ));
    const product = await this.prisma.product.findUniqueOrThrow({ where: { id: productId }, include: productInclude });
    const primary = product.images.find((image) => image.isPrimary);
    const card = primary?.uploadAsset.renditions.find((rendition) => rendition.kind === UploadRenditionKind.CARD);
    await this.prisma.product.update({
      where: { id: productId },
      data: { imageUrl: card?.secureUrl ?? null }
    });
    await this.invalidatePublicShopProductCache(dto.storeId, "product.images.reorder");
    return { apiVersion: "v1", product: toProductResponse(product) };
  }

  async replaceImage(auth: AuthenticatedPrincipal, productId: string, imageId: string, dto: ReplaceProductImageDto) {
    await this.assertProductAccess(auth, productId, dto.storeId);
    const productImage = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId }
    });
    if (!productImage) {
      throw uploadError(HttpStatus.NOT_FOUND, "PRODUCT_IMAGE_NOT_FOUND", "Product image not found.");
    }
    await this.loadAttachableAssets(dto.storeId, [dto.uploadAssetId]);
    await this.prisma.$transaction([
      this.prisma.productImage.update({
        where: { id: imageId },
        data: { uploadAssetId: dto.uploadAssetId }
      }),
      this.prisma.uploadAsset.update({
        where: { id: dto.uploadAssetId },
        data: { status: UploadAssetStatus.ATTACHED, attachedAt: new Date() }
      }),
      this.prisma.uploadAsset.update({
        where: { id: productImage.uploadAssetId },
        data: { status: UploadAssetStatus.ORPHANED, failureReason: "product_image_replaced" }
      })
    ]);
    const product = await this.prisma.product.findUniqueOrThrow({ where: { id: productId }, include: productInclude });
    await this.invalidatePublicShopProductCache(dto.storeId, "product.images.replace");
    return { apiVersion: "v1", product: toProductResponse(product) };
  }

  async deleteImage(auth: AuthenticatedPrincipal, productId: string, imageId: string, storeId: string) {
    await this.assertProductAccess(auth, productId, storeId);
    const productImage = await this.prisma.productImage.findFirst({
      where: { id: imageId, productId }
    });
    if (!productImage) {
      throw uploadError(HttpStatus.NOT_FOUND, "PRODUCT_IMAGE_NOT_FOUND", "Product image not found.");
    }
    await this.prisma.$transaction([
      this.prisma.productImage.delete({ where: { id: imageId } }),
      this.prisma.uploadAsset.update({
        where: { id: productImage.uploadAssetId },
        data: { status: UploadAssetStatus.ORPHANED, failureReason: "product_image_deleted" }
      })
    ]);
    const product = await this.prisma.product.findUniqueOrThrow({ where: { id: productId }, include: productInclude });
    await this.invalidatePublicShopProductCache(storeId, "product.images.delete");
    return { apiVersion: "v1", product: toProductResponse(product) };
  }

  private async invalidatePublicShopProductCache(storeId: string, operation: string) {
    await this.shops.invalidateShopCaches({ keyFamily: "products", operation, storeId });
  }

  private async assertStoreAccess(auth: AuthenticatedPrincipal, storeId: string) {
    const cacheKey = `${auth.userId}:${auth.authzVersion}:${storeId}:product-manage`;
    if (getCached(this.storeAccessCache, cacheKey)) {
      return;
    }
    const [store, authorization] = await Promise.all([
      this.prisma.store.findFirst({
        where: {
          id: storeId,
          deletedAt: null,
          status: { in: [StoreStatus.APPROVED, StoreStatus.PENDING] }
        },
        select: { id: true }
      }),
      this.rbac.storeAuthorization(auth.userId, storeId, auth.authzVersion)
    ]);
    if (!store) {
      throw uploadError(HttpStatus.NOT_FOUND, "STORE_NOT_FOUND", "Store not found.");
    }
    if (!this.rbac.hasPermissions(authorization.permissions, [PERMISSIONS.PRODUCT_MANAGE])) {
      throw uploadError(HttpStatus.FORBIDDEN, "PRODUCT_FORBIDDEN", "Insufficient product permissions.");
    }
    setCached(this.storeAccessCache, cacheKey, true, HOT_CACHE_TTL_MS);
  }

  private async assertProductAccess(auth: AuthenticatedPrincipal, productId: string, storeId: string) {
    await this.assertStoreAccess(auth, storeId);
    const product = await this.prisma.product.findFirst({ where: { id: productId, storeId }, select: { id: true } });
    if (!product) {
      throw uploadError(HttpStatus.NOT_FOUND, "PRODUCT_NOT_FOUND", "Product not found.");
    }
  }

  private async createProductGraph(input: ProductCreateGraphInput) {
    const expectedAssetCount = new Set(input.imageRows.map((image) => image.uploadAssetId)).size;
    const rows = await this.prisma.$queryRaw<ProductCreateGraphRow[]>(Prisma.sql`
      WITH
      variant_input AS (
        SELECT *
        FROM jsonb_to_recordset(${JSON.stringify(input.variantRows)}::jsonb) AS variant(
          id uuid,
          "productId" uuid,
          name text,
          sku text,
          price numeric,
          mrp numeric,
          "costPrice" numeric,
          "pricePerBaseUnit" numeric,
          stock integer,
          "stockOnHand" integer,
          "stockReserved" integer,
          "stockVersion" integer,
          "unitGroup" text,
          "quantityValue" numeric,
          "quantityUnit" text,
          "normalizedValue" numeric,
          "normalizedUnit" text,
          "packType" text,
          "isDefault" boolean,
          position integer
        )
      ),
      image_input AS (
        SELECT *
        FROM jsonb_to_recordset(${JSON.stringify(input.imageRows)}::jsonb) AS image(
          id uuid,
          "productId" uuid,
          "uploadAssetId" uuid,
          "sortOrder" integer,
          "isPrimary" boolean,
          "altText" text
        )
      ),
      image_variant_input AS (
        SELECT *
        FROM jsonb_to_recordset(${JSON.stringify(input.imageVariantRows)}::jsonb) AS image_variant(
          "productImageId" uuid,
          "productVariantId" uuid,
          "uploadAssetId" uuid
        )
      ),
      valid_assets AS (
        SELECT
          ua.id,
          ua.original_filename,
          rendition.kind,
          rendition.secure_url,
          rendition.width,
          rendition.height,
          rendition.bytes,
          rendition.format
        FROM upload_assets ua
        JOIN image_input image ON image."uploadAssetId" = ua.id
        JOIN upload_asset_renditions rendition
          ON rendition.upload_asset_id = ua.id
         AND rendition.kind = ${UploadRenditionKind.CARD}::"UploadRenditionKind"
        WHERE ua.store_id = ${input.product.storeId}::uuid
          AND ua.purpose = ${UploadPurpose.PRODUCT_IMAGE}::"UploadPurpose"
          AND ua.status = ${UploadAssetStatus.READY}::"UploadAssetStatus"
          AND (ua.expires_at IS NULL OR ua.expires_at > now())
          AND NOT EXISTS (
            SELECT 1
            FROM product_images existing_image
            WHERE existing_image.upload_asset_id = ua.id
          )
      ),
      asset_check AS (
        SELECT COUNT(DISTINCT id)::integer AS count
        FROM valid_assets
      ),
      product_insert AS (
        INSERT INTO products (
          id,
          store_id,
          category_id,
          name,
          sku,
          sub_category,
          product_type,
          description,
          seo_title,
          seo_description,
          price,
          compare_at_price,
          stock,
          reorder_point,
          unit_group,
          quantity_value,
          quantity_unit,
          normalized_value,
          normalized_unit,
          pack_type,
          price_per_base_unit,
          catalog_version,
          status,
          image_url,
          created_at,
          updated_at
        )
        SELECT
          ${input.product.id}::uuid,
          ${input.product.storeId}::uuid,
          ${input.product.categoryId}::uuid,
          ${input.product.name},
          ${input.product.sku},
          ${input.product.subCategory},
          ${input.product.productType},
          ${input.product.description},
          ${input.product.seoTitle},
          ${input.product.seoDescription},
          ${input.product.price},
          ${input.product.compareAtPrice},
          ${input.product.stock},
          ${input.product.reorderPoint},
          ${input.product.unitGroup}::"UnitGroup",
          ${input.product.quantityValue},
          ${input.product.quantityUnit}::"MeasurementUnit",
          ${input.product.normalizedValue},
          ${input.product.normalizedUnit}::"MeasurementUnit",
          ${input.product.packType}::"PackType",
          ${input.product.pricePerBaseUnit},
          COALESCE(${input.product.catalogVersion ?? 1}, 1),
          ${input.product.status}::"ProductStatus",
          (
            SELECT secure_url
            FROM valid_assets
            WHERE id = ${input.product.primaryUploadAssetId}::uuid
            LIMIT 1
          ),
          now(),
          now()
        WHERE (SELECT count FROM asset_check) = ${expectedAssetCount}
        RETURNING
          id,
          store_id AS "storeId",
          category_id AS "categoryId",
          name,
          sku,
          sub_category AS "subCategory",
          product_type AS "productType",
          description,
          seo_title AS "seoTitle",
          seo_description AS "seoDescription",
          price,
          compare_at_price AS "compareAtPrice",
          stock,
          reorder_point AS "reorderPoint",
          unit_group AS "unitGroup",
          quantity_value AS "quantityValue",
          quantity_unit AS "quantityUnit",
          normalized_value AS "normalizedValue",
          normalized_unit AS "normalizedUnit",
          pack_type AS "packType",
          price_per_base_unit AS "pricePerBaseUnit",
          catalog_version AS "catalogVersion",
          status,
          image_url AS "imageUrl",
          is_active AS "isActive",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
      ),
      insert_variants AS (
        INSERT INTO product_variants (
          id,
          product_id,
          name,
          sku,
          price,
          mrp,
          cost_price,
          price_per_base_unit,
          stock,
          stock_on_hand,
          stock_reserved,
          stock_version,
          unit_group,
          quantity_value,
          quantity_unit,
          normalized_value,
          normalized_unit,
          pack_type,
          is_default,
          position,
          created_at,
          updated_at
        )
        SELECT
          variant.id,
          product.id,
          variant.name,
          variant.sku,
          variant.price,
          variant.mrp,
          variant."costPrice",
          variant."pricePerBaseUnit",
          variant.stock,
          variant."stockOnHand",
          variant."stockReserved",
          variant."stockVersion",
          variant."unitGroup"::"UnitGroup",
          variant."quantityValue",
          variant."quantityUnit"::"MeasurementUnit",
          variant."normalizedValue",
          variant."normalizedUnit"::"MeasurementUnit",
          variant."packType"::"PackType",
          COALESCE(variant."isDefault", false),
          COALESCE(variant.position, 0),
          now(),
          now()
        FROM variant_input variant
        JOIN product_insert product ON true
        RETURNING id
      ),
      insert_images AS (
        INSERT INTO product_images (
          id,
          product_id,
          upload_asset_id,
          sort_order,
          is_primary,
          alt_text,
          created_at,
          updated_at
        )
        SELECT
          image.id,
          product.id,
          image."uploadAssetId",
          image."sortOrder",
          image."isPrimary",
          image."altText",
          now(),
          now()
        FROM image_input image
        JOIN product_insert product ON true
        RETURNING id
      ),
      insert_image_variants AS (
        INSERT INTO product_image_variants (
          product_image_id,
          product_variant_id
        )
        SELECT
          image_variant."productImageId",
          image_variant."productVariantId"
        FROM image_variant_input image_variant
        JOIN product_insert product ON true
        ON CONFLICT DO NOTHING
        RETURNING product_image_id
      ),
      update_assets AS (
        UPDATE upload_assets
        SET
          status = ${UploadAssetStatus.ATTACHED}::"UploadAssetStatus",
          attached_at = now(),
          updated_at = now()
        WHERE id IN (SELECT id FROM valid_assets)
          AND EXISTS (SELECT 1 FROM product_insert)
        RETURNING id
      )
      SELECT
        (SELECT count FROM asset_check) AS "assetCount",
        (SELECT row_to_json(product_insert) FROM product_insert) AS product,
        (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'id', valid_assets.id,
            'originalFilename', valid_assets.original_filename,
            'renditions', jsonb_build_array(jsonb_build_object(
              'kind', valid_assets.kind,
              'secureUrl', valid_assets.secure_url,
              'width', valid_assets.width,
              'height', valid_assets.height,
              'bytes', valid_assets.bytes,
              'format', valid_assets.format
            ))
          )), '[]'::jsonb)
          FROM valid_assets
        ) AS assets
    `);
    const row = rows[0];
    if (!row || Number(row.assetCount) !== expectedAssetCount || !row.product) {
      throw uploadError(HttpStatus.BAD_REQUEST, "UPLOAD_ASSET_NOT_ATTACHABLE", "One or more uploaded images are no longer attachable.");
    }
    const variantsById = new Map(input.variantRows.map((variant) => [variant.id, variant]));
    const imageVariantsByAssetId = new Map<string, ProductVariantResponseSource[]>();
    for (const link of input.imageVariantRows) {
      const variant = variantsById.get(link.productVariantId);
      if (!variant) {
        continue;
      }
      const variants = imageVariantsByAssetId.get(link.uploadAssetId) ?? [];
      variants.push(variant);
      imageVariantsByAssetId.set(link.uploadAssetId, variants);
    }
    return {
      product: normalizeRawProduct(row.product),
      variants: input.variantRows,
      images: input.imageRows,
      assets: new Map((row.assets ?? []).map((asset) => [asset.id, asset])),
      imageVariantsByAssetId
    };
  }

  private async createProductImages(
    tx: Prisma.TransactionClient,
    input: {
      productId: string;
      images: ProductImageInputDto[];
      imageRows: ProductImageResponseSource[];
      variantsBySku: Map<string, string>;
      variantsByClientId: Map<string, string>;
      variants: ProductVariantResponseSource[];
    }
  ) {
    if (!input.images.length) {
      return {
        images: [] as ProductImageResponseSource[],
        imageVariantsByAssetId: new Map<string, ProductVariantResponseSource[]>()
      };
    }

    assertVariantImageAssignments(input.images, input.variantsBySku, input.variantsByClientId);
    await tx.productImage.createMany({ data: input.imageRows });
    const imagesByAssetId = new Map(input.imageRows.map((image) => [image.uploadAssetId, image]));
    const variantsById = new Map(input.variants.map((variant) => [variant.id, variant]));
    const imageVariantRows: Prisma.ProductImageVariantCreateManyInput[] = [];
    const imageVariantsByAssetId = new Map<string, ProductVariantResponseSource[]>();

    for (const image of input.images) {
      const productImage = imagesByAssetId.get(image.uploadAssetId);
      if (!productImage) {
        continue;
      }
      const variantIds = imageVariantIds(image, input.variantsBySku, input.variantsByClientId);
      imageVariantsByAssetId.set(
        image.uploadAssetId,
        variantIds
          .map((productVariantId) => variantsById.get(productVariantId))
          .filter((variant): variant is ProductVariantResponseSource => Boolean(variant))
      );
      for (const productVariantId of variantIds) {
        imageVariantRows.push({
          productImageId: productImage.id,
          productVariantId
        });
      }
    }

    if (imageVariantRows.length) {
      await tx.productImageVariant.createMany({
        data: imageVariantRows,
        skipDuplicates: true
      });
    }
    await tx.uploadAsset.updateMany({
      where: { id: { in: input.images.map((image) => image.uploadAssetId) } },
      data: {
        status: UploadAssetStatus.ATTACHED,
        attachedAt: new Date()
      }
    });

    return { images: input.imageRows, imageVariantsByAssetId };
  }

  private validateImageRules(status: ProductStatus, images: ProductImageInputDto[]) {
    if (images.length > 8) {
      throw uploadError(HttpStatus.BAD_REQUEST, "PRODUCT_TOO_MANY_IMAGES", "Products can have at most eight images.");
    }
    if (status === ProductStatus.PUBLISHED && images.length < 1) {
      throw uploadError(HttpStatus.BAD_REQUEST, "PRODUCT_IMAGES_REQUIRED", "Published products require at least one image.");
    }
    if (images.length) {
      this.assertSinglePrimary(images);
    }
  }

  private assertSinglePrimary(images: ProductImageInputDto[]) {
    if (images.filter((image) => image.isPrimary).length !== 1) {
      throw uploadError(HttpStatus.BAD_REQUEST, "PRODUCT_PRIMARY_IMAGE_REQUIRED", "Exactly one product image must be primary.");
    }
  }

  private async loadAttachableAssets(storeId: string, uploadAssetIds: string[]): Promise<Map<string, AttachableAsset>> {
    const uniqueIds = Array.from(new Set(uploadAssetIds));
    if (!uniqueIds.length) {
      return new Map<string, AttachableAsset>();
    }
    const assets = await this.prisma.uploadAsset.findMany({
      where: {
        id: { in: uniqueIds },
        storeId,
        purpose: UploadPurpose.PRODUCT_IMAGE,
        status: UploadAssetStatus.READY,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        productImage: null
      },
      select: attachableAssetSelect
    });
    if (assets.length !== uniqueIds.length) {
      throw uploadError(HttpStatus.BAD_REQUEST, "UPLOAD_ASSET_NOT_ATTACHABLE", "One or more uploaded images are no longer attachable.");
    }
    return new Map(assets.map((asset) => [asset.id, asset]));
  }

  private async ensureCategory(name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      return null;
    }
    const cacheKey = trimmed;
    const cached = getCached(this.categoryCache, cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const category = await this.prisma.category.upsert({
      where: { name: trimmed },
      update: {},
      create: {
        name: trimmed,
        slug: slugify(trimmed)
      },
      select: { id: true, name: true }
    });
    setCached(this.categoryCache, cacheKey, category, HOT_CACHE_TTL_MS);
    return category;
  }

  private normalizeMeasurement(
    input: ProductMeasurementInputDto | undefined,
    context: Pick<CreateProductDto, "category" | "subCategory" | "productType">,
    price: number
  ) {
    try {
      return normalizeProductMeasurement(input, {
        category: context.category,
        subCategory: context.subCategory,
        productType: context.productType,
        price
      });
    } catch (error) {
      if (error instanceof ProductMeasurementError) {
        throw uploadError(HttpStatus.BAD_REQUEST, error.code, error.message, false, error.details);
      }
      throw error;
    }
  }

  private normalizedVariants(dto: CreateProductDto, productMeasurement: NormalizedMeasurement) {
    const dtoVariants = dto.variants ?? [];
    const variants = dtoVariants.length
      ? dtoVariants
      : [{
          name: "Default",
          sku: dto.sku,
          price: dto.price,
          mrp: dto.compareAtPrice,
          costPrice: undefined,
          stock: dto.stock,
          clientId: undefined,
          measurement: dto.measurement
        }];
    const fallbackSku = dtoVariants.length ? null : normalizeOptionalSku(dto.sku);
    return variants.map((variant, index) => {
      this.validateVariantPrice(variant);
      const measurement = this.normalizeMeasurement(variant.measurement ?? dto.measurement, dto, variant.price);
      const isDefault = index === 0 || variant.clientId?.trim() === "base-product";
      return {
        clientId: variant.clientId?.trim() || null,
        name: variant.name.trim() || "Default",
        sku: normalizeOptionalSku(variant.sku) ?? fallbackSku,
        price: variant.price,
        // toMrp() normalises 0 / undefined / null → null so the DB constraint
        // (mrp IS NULL OR mrp >= price) is never violated by an unset MRP.
        mrp: toMrp(variant.mrp) ?? toMrp(dto.compareAtPrice) ?? null,
        costPrice: variant.costPrice ?? null,
        stock: variant.stock,
        measurement: variant.measurement ? measurement : { ...productMeasurement, pricePerBaseUnit: measurement.pricePerBaseUnit, pricePerBaseUnitDisplay: measurement.pricePerBaseUnitDisplay },
        isDefault,
        position: isDefault ? 0 : index
      };
    });
  }

  private validateVariantPrice(variant: ProductVariantInputDto) {
    // mrp = 0 is treated as "not set"; only validate when mrp is a positive number
    const effectiveMrp = variant.mrp !== undefined && variant.mrp > 0 ? variant.mrp : null;
    if (effectiveMrp !== null && variant.price > 0 && effectiveMrp < variant.price) {
      throw uploadError(
        HttpStatus.BAD_REQUEST,
        "PRODUCT_PRICE_MRP_BELOW_SELLING_PRICE",
        "MRP must be greater than or equal to the selling price.",
        false,
        { price: variant.price, mrp: variant.mrp }
      );
    }
  }

  private validateProductPrice(dto: CreateProductDto) {
    if (dto.compareAtPrice !== undefined && dto.compareAtPrice > 0 && dto.price > 0 && dto.compareAtPrice < dto.price) {
      throw uploadError(
        HttpStatus.BAD_REQUEST,
        "PRODUCT_PRICE_MRP_BELOW_SELLING_PRICE",
        "Compare-at price must be greater than or equal to the selling price.",
        false,
        { price: dto.price, compareAtPrice: dto.compareAtPrice }
      );
    }
  }
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

async function timeStage<T>(
  timer: RequestTimer | undefined,
  stage: string,
  callback: () => Promise<T>
): Promise<T> {
  return timer ? timer.time(stage, callback) : callback();
}

function timeStageSync<T>(
  timer: RequestTimer | undefined,
  stage: string,
  callback: () => T
): T {
  return timer ? timer.timeSync(stage, callback) : callback();
}

function isSparseProductUpdate(dto: UpdateProductDto) {
  return dto.expectedCatalogVersion !== undefined || !isLegacyFullUpdateDto(dto);
}

function isLegacyFullUpdateDto(dto: UpdateProductDto) {
  return (
    typeof dto.name === "string" &&
    typeof dto.category === "string" &&
    typeof dto.price === "number" &&
    typeof dto.stock === "number" &&
    typeof dto.reorderPoint === "number" &&
    typeof dto.status === "string" &&
    Array.isArray(dto.images) &&
    Array.isArray(dto.variants)
  );
}

function fullProductUpdateDto(dto: UpdateProductDto): CreateProductDto {
  if (isLegacyFullUpdateDto(dto)) {
    return dto as CreateProductDto;
  }
  throw uploadError(
    HttpStatus.BAD_REQUEST,
    "PRODUCT_UPDATE_INVALID",
    "Send expectedCatalogVersion for sparse updates or a complete legacy product payload."
  );
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function normalizeOptionalSku(value: string | undefined | null) {
  const sku = value?.trim().toUpperCase();
  return sku || null;
}

function normalizeOptionalText(value: string | undefined | null) {
  const text = value?.trim();
  return text || null;
}

/**
 * Converts a "not set" MRP/compareAtPrice value to null for DB writes.
 *
 * The frontend uses 0 to represent "no MRP set" (a falsy sentinel). The DB
 * constraint requires: mrp IS NULL OR mrp >= price.
 * A value of 0 with price > 0 violates this constraint, so we normalise
 * 0 → null here before the value ever reaches a Prisma write.
 */
function toMrp(value: number | undefined | null): number | null {
  if (value === undefined || value === null || value === 0) return null;
  return value;
}

function variantsBySkuMap(variants: Array<{ id: string; sku: string | null }>) {
  return new Map(
    variants
      .filter((variant): variant is { id: string; sku: string } => Boolean(variant.sku))
      .map((variant) => [variant.sku, variant.id])
  );
}

function variantsByClientIdMap(
  inputs: Array<{ clientId: string | null }>,
  variants: Array<{ id: string }>
) {
  return new Map(
    inputs
      .map((input, index) => [input.clientId, variants[index]?.id] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1]))
  );
}

function imageVariantIds(
  image: ProductImageInputDto,
  variantsBySku: Map<string, string>,
  variantsByClientId: Map<string, string>
) {
  if ((image.imageScope ?? "PRODUCT") !== "VARIANT") {
    return [];
  }
  const ids = new Set<string>();
  for (const clientId of image.variantClientIds ?? []) {
    const productVariantId = variantsByClientId.get(clientId);
    if (productVariantId) ids.add(productVariantId);
  }
  for (const sku of image.variantSkuIds ?? []) {
    const productVariantId = variantsBySku.get(sku.toUpperCase());
    if (productVariantId) ids.add(productVariantId);
  }
  return Array.from(ids);
}

function assertVariantImageAssignments(
  images: ProductImageInputDto[],
  variantsBySku: Map<string, string>,
  variantsByClientId: Map<string, string>
) {
  for (const image of images) {
    if ((image.imageScope ?? "PRODUCT") !== "VARIANT") {
      continue;
    }
    if (imageVariantIds(image, variantsBySku, variantsByClientId).length > 0) {
      continue;
    }
    throw uploadError(
      HttpStatus.BAD_REQUEST,
      "PRODUCT_VARIANT_IMAGE_ASSIGNMENT_REQUIRED",
      "Variant images must be assigned to at least one variant."
    );
  }
}

function productVariantCreateData(
  productId: string,
  variant: {
    name: string;
    sku: string | null;
    price: number;
    mrp: number | null;
    costPrice: number | null;
    stock: number;
    measurement: NormalizedMeasurement;
    isDefault?: boolean;
    position?: number;
  },
  id = randomUUID()
): Prisma.ProductVariantCreateManyInput & ProductVariantResponseSource {
  return {
    id,
    productId,
    name: variant.name,
    sku: variant.sku,
    price: variant.price,
    mrp: variant.mrp,
    costPrice: variant.costPrice,
    pricePerBaseUnit: variant.measurement.pricePerBaseUnit,
    stock: variant.stock,
    stockOnHand: variant.stock,
    stockReserved: 0,
    stockVersion: 1,
    unitGroup: variant.measurement.unitGroup,
    quantityValue: variant.measurement.quantityValue,
    quantityUnit: variant.measurement.quantityUnit,
    normalizedValue: variant.measurement.normalizedValue,
    normalizedUnit: variant.measurement.normalizedUnit,
    packType: variant.measurement.packType,
    isDefault: variant.isDefault ?? false,
    position: variant.position ?? 0
  };
}

function productImageCreateRows(
  productId: string,
  images: ProductImageInputDto[]
): ProductImageResponseSource[] {
  return images.map((image) => ({
    id: randomUUID(),
    productId,
    uploadAssetId: image.uploadAssetId,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary,
    altText: image.altText?.trim() || null
  }));
}

function productImageVariantCreateRows(
  images: ProductImageInputDto[],
  imageRows: ProductImageResponseSource[],
  variantsBySku: Map<string, string>,
  variantsByClientId: Map<string, string>
): ProductImageVariantRow[] {
  const imagesByAssetId = new Map(imageRows.map((image) => [image.uploadAssetId, image]));
  return images.flatMap((image) => {
    const productImage = imagesByAssetId.get(image.uploadAssetId);
    if (!productImage) {
      return [];
    }
    return imageVariantIds(image, variantsBySku, variantsByClientId).map((productVariantId) => ({
      productImageId: productImage.id,
      productVariantId,
      uploadAssetId: image.uploadAssetId
    }));
  });
}

function normalizeImages(images: ProductImageInputDto[]) {
  return images
    .map((image, index) => ({
      ...image,
      imageScope: image.imageScope ?? "PRODUCT",
      sortOrder: image.sortOrder ?? index,
      variantClientIds: image.variantClientIds?.map((id) => id.trim()).filter(Boolean),
      variantSkuIds: image.variantSkuIds?.map((sku) => sku.toUpperCase())
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function primaryInput(images: ProductImageInputDto[]) {
  return images.find((image) => image.isPrimary);
}

function decimalToNullableNumber(value: Decimalish | null | undefined) {
  return value === null || value === undefined ? null : Number(value);
}

function samePersistedMeasurement(
  product: Pick<ProductModel, "unitGroup" | "quantityValue" | "quantityUnit" | "normalizedValue" | "normalizedUnit" | "packType" | "pricePerBaseUnit">,
  measurement: NormalizedMeasurement
) {
  return (
    product.unitGroup === measurement.unitGroup &&
    Number(product.quantityValue) === measurement.quantityValue &&
    product.quantityUnit === measurement.quantityUnit &&
    Number(product.normalizedValue) === measurement.normalizedValue &&
    product.normalizedUnit === measurement.normalizedUnit &&
    product.packType === measurement.packType &&
    Number(product.pricePerBaseUnit) === measurement.pricePerBaseUnit
  );
}

function sameMeasurementInput(
  product: Pick<ProductModel, "unitGroup" | "quantityValue" | "quantityUnit" | "packType">,
  measurement: ProductMeasurementInputDto
) {
  return (
    product.unitGroup === measurement.unitGroup &&
    Number(product.quantityValue) === measurement.quantityValue &&
    product.quantityUnit === measurement.quantityUnit &&
    product.packType === measurement.packType
  );
}

function sparsePatchAlreadyApplied(
  product: ProductModel & { category?: CategoryRef | null },
  dto: UpdateProductDto
) {
  return (
    (dto.name === undefined || product.name === dto.name.trim()) &&
    (dto.sku === undefined || product.sku === normalizeOptionalSku(dto.sku)) &&
    (dto.category === undefined || (product.category?.name ?? "Grocery") === dto.category.trim()) &&
    (dto.subCategory === undefined || product.subCategory === normalizeOptionalText(dto.subCategory)) &&
    (dto.productType === undefined || product.productType === normalizeOptionalText(dto.productType)) &&
    (dto.price === undefined || Number(product.price) === dto.price) &&
    (dto.compareAtPrice === undefined || decimalToNullableNumber(product.compareAtPrice) === toMrp(dto.compareAtPrice)) &&
    (dto.stock === undefined || product.stock === dto.stock) &&
    (dto.reorderPoint === undefined || product.reorderPoint === dto.reorderPoint) &&
    (dto.status === undefined || product.status === toDbStatus(dto.status)) &&
    (dto.seoTitle === undefined || product.seoTitle === normalizeOptionalText(dto.seoTitle)) &&
    (dto.seoDescription === undefined || product.seoDescription === normalizeOptionalText(dto.seoDescription)) &&
    (dto.measurement === undefined || sameMeasurementInput(product, dto.measurement))
  );
}

function sparseProductResponse(
  product: ProductModel,
  categoryName: string,
  alreadyApplied = false
) {
  const measurement = {
    unitGroup: product.unitGroup,
    quantityValue: Number(product.quantityValue),
    quantityUnit: product.quantityUnit,
    normalizedValue: Number(product.normalizedValue),
    normalizedUnit: product.normalizedUnit,
    packType: product.packType,
    pricePerBaseUnit: Number(product.pricePerBaseUnit)
  };
  return {
    id: product.id,
    name: product.name,
    sku: product.sku ?? "",
    category: categoryName,
    subCategory: product.subCategory ?? "",
    productType: product.productType ?? "",
    price: Number(product.price),
    compareAtPrice: product.compareAtPrice ? Number(product.compareAtPrice) : 0,
    stock: product.stock,
    reorderPoint: product.reorderPoint,
    measurement,
    unitDisplay: formatUnitDisplay(measurement),
    pricePerBaseUnit: Number(product.pricePerBaseUnit),
    pricePerBaseUnitDisplay: formatPricePerBaseUnitDisplay(Number(product.pricePerBaseUnit), product.unitGroup),
    status: toUiStatus(product.status),
    seoTitle: product.seoTitle ?? "",
    seoDescription: product.seoDescription ?? "",
    catalogVersion: product.catalogVersion,
    updatedAt: product.updatedAt.toISOString(),
    ...(alreadyApplied ? { alreadyApplied: true } : {})
  };
}

function toDbStatus(status: string): ProductStatus {
  if (status === "Published") return ProductStatus.PUBLISHED;
  if (status === "Paused") return ProductStatus.PAUSED;
  if (status === "Needs review") return ProductStatus.NEEDS_REVIEW;
  return ProductStatus.DRAFT;
}

function toUiStatus(status: ProductStatus) {
  if (status === ProductStatus.PUBLISHED) return "Published";
  if (status === ProductStatus.PAUSED) return "Paused";
  if (status === ProductStatus.NEEDS_REVIEW) return "Needs review";
  return "Draft";
}

function toVariantResponse(variant: ProductVariantResponseSource) {
  const measurement = {
    unitGroup: variant.unitGroup,
    quantityValue: Number(variant.quantityValue),
    quantityUnit: variant.quantityUnit,
    normalizedValue: Number(variant.normalizedValue),
    normalizedUnit: variant.normalizedUnit,
    packType: variant.packType,
    pricePerBaseUnit: Number(variant.pricePerBaseUnit)
  };
  const available = availableStock(variant.stockOnHand, variant.stockReserved);
  return {
    id: variant.id,
    name: variant.name,
    sku: variant.sku ?? "",
    price: Number(variant.price),
    mrp: variant.mrp ? Number(variant.mrp) : 0,
    costPrice: variant.costPrice ? Number(variant.costPrice) : 0,
    stock: available,
    stockOnHand: variant.stockOnHand,
    stockReserved: variant.stockReserved,
    stockVersion: variant.stockVersion,
    isDefault: variant.isDefault,
    position: variant.position,
    measurement,
    unitDisplay: formatUnitDisplay(measurement),
    pricePerBaseUnit: Number(variant.pricePerBaseUnit),
    pricePerBaseUnitDisplay: formatPricePerBaseUnitDisplay(Number(variant.pricePerBaseUnit), variant.unitGroup)
  };
}

function toImageResponse(
  image: ProductImageResponseSource,
  uploadAsset: Pick<AttachableAsset, "originalFilename" | "renditions">,
  variants: Array<Pick<ProductVariantResponseSource, "id" | "sku">>
) {
  const renditions = Object.fromEntries(uploadAsset.renditions.map((rendition) => [
    renditionKey(rendition.kind),
    {
      secureUrl: rendition.secureUrl,
      width: rendition.width,
      height: rendition.height,
      bytes: rendition.bytes,
      format: rendition.format
    }
  ]));
  const card = uploadAsset.renditions.find((rendition) => rendition.kind === UploadRenditionKind.CARD);
  return {
    id: image.id,
    uploadAssetId: image.uploadAssetId,
    name: uploadAsset.originalFilename,
    url: card?.secureUrl ?? uploadAsset.renditions[0]?.secureUrl ?? "",
    focus: "Center" as const,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary,
    altText: image.altText,
    variantIds: variants.map((variant) => variant.id),
    variantSkuIds: variants
      .map((variant) => variant.sku)
      .filter((sku): sku is string => Boolean(sku)),
    renditions
  };
}

function toProductResponseFromParts(input: {
  product: ProductModel;
  categoryName: string;
  variants: ReturnType<typeof toVariantResponse>[];
  images: ReturnType<typeof toImageResponse>[];
}) {
  const defaultVariant = input.variants[0];
  const productMeasurement = {
    unitGroup: input.product.unitGroup,
    quantityValue: Number(input.product.quantityValue),
    quantityUnit: input.product.quantityUnit,
    normalizedValue: Number(input.product.normalizedValue),
    normalizedUnit: input.product.normalizedUnit,
    packType: input.product.packType,
    pricePerBaseUnit: Number(input.product.pricePerBaseUnit)
  };
  return {
    id: input.product.id,
    name: input.product.name,
    sku: input.product.sku ?? "",
    category: input.categoryName,
    subCategory: input.product.subCategory ?? "",
    productType: input.product.productType ?? "",
    price: defaultVariant?.price ?? Number(input.product.price),
    compareAtPrice: input.product.compareAtPrice ? Number(input.product.compareAtPrice) : 0,
    stock: input.variants.length ? input.variants.reduce((total, variant) => total + variant.stock, 0) : input.product.stock,
    reorderPoint: input.product.reorderPoint,
    measurement: productMeasurement,
    unitDisplay: defaultVariant?.unitDisplay ?? formatUnitDisplay(productMeasurement),
    pricePerBaseUnit: defaultVariant?.pricePerBaseUnit ?? Number(input.product.pricePerBaseUnit),
    pricePerBaseUnitDisplay:
      defaultVariant?.pricePerBaseUnitDisplay ??
      formatPricePerBaseUnitDisplay(Number(input.product.pricePerBaseUnit), input.product.unitGroup),
    status: toUiStatus(input.product.status),
    seoTitle: input.product.seoTitle ?? "",
    seoDescription: input.product.seoDescription ?? "",
    sales: 0,
    revenue: 0,
    conversion: 0,
    images: input.images,
    variants: input.variants,
    catalogVersion: input.product.catalogVersion,
    updatedAt: input.product.updatedAt.toISOString()
  };
}

function toProductResponse(product: Prisma.ProductGetPayload<{ include: typeof productInclude }>) {
  return toProductResponseFromParts({
    product,
    categoryName: product.category?.name ?? "Grocery",
    variants: product.variants.map(toVariantResponse),
    images: product.images.map((image) =>
      toImageResponse(
        {
          id: image.id,
          productId: image.productId,
          uploadAssetId: image.uploadAssetId,
          sortOrder: image.sortOrder,
          isPrimary: image.isPrimary,
          altText: image.altText
        },
        image.uploadAsset,
        image.variants.map((item) => item.productVariant)
      )
    )
  });
}

function normalizeRawProduct(product: ProductModel): ProductModel {
  return {
    ...product,
    createdAt: product.createdAt instanceof Date ? product.createdAt : new Date(product.createdAt),
    updatedAt: product.updatedAt instanceof Date ? product.updatedAt : new Date(product.updatedAt)
  };
}

function toWrittenProductResponse(input: {
  product: ProductModel;
  category: CategoryRef | null;
  images: ProductImageResponseSource[];
  variants: ProductVariantResponseSource[];
  assets: Map<string, AttachableAsset>;
  imageVariantsByAssetId: Map<string, ProductVariantResponseSource[]>;
}) {
  return toProductResponseFromParts({
    product: input.product,
    categoryName: input.category?.name ?? "Grocery",
    variants: input.variants.map(toVariantResponse),
    images: [...input.images]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((image) => {
        const asset = input.assets.get(image.uploadAssetId);
        if (!asset) {
          throw uploadError(
            HttpStatus.INTERNAL_SERVER_ERROR,
            "PRODUCT_IMAGE_ASSET_MISSING",
            "Product image asset metadata was not loaded."
          );
        }
        return toImageResponse(
          image,
          asset,
          input.imageVariantsByAssetId.get(image.uploadAssetId) ?? []
        );
      })
  });
}

function renditionKey(kind: UploadRenditionKind): string {
  if (kind === UploadRenditionKind.JPEG_FALLBACK) {
    return "jpegFallback";
  }
  return kind.toLowerCase().replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || `category-${Date.now().toString(36)}`;
}
