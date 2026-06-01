import { ProductStatus, StoreStatus, UploadRenditionKind } from "@prisma/client";
import { ProductsService } from "../../modules/products/products.service";
import { PERMISSIONS } from "../../modules/rbac/permissions";

const storeId = "1fc57307-2833-4a96-a7c6-810bcdc2d206";
const userId = "3f9d58cf-65e1-4a9b-bf87-a777d32af171";
const assetA = "f79a8c72-7838-4e42-967b-089696bd31e8";
const assetB = "f41743c7-870c-4141-bd5f-c9fa7f252a4b";

describe("ProductsService product save hot path", () => {
  it("creates a published product with batched variants, images, and image variant links", async () => {
    const { prisma, tx, inventory, service } = createHarness({ assetCount: 2 });

    const response = await service.create(auth(), {
      storeId,
      name: "Aachi chilli powder",
      category: "Grocery",
      subCategory: "Spices & Masala",
      productType: "Chilli Powder",
      price: 40,
      stock: 20,
      reorderPoint: 10,
      measurement: { unitGroup: "WEIGHT", quantityValue: 100, quantityUnit: "G", packType: "PACK" },
      status: "Published",
      seoDescription: "test description",
      images: [
        { uploadAssetId: assetA, sortOrder: 0, isPrimary: true, altText: "Front", imageScope: "VARIANT", variantClientIds: ["small"] },
        { uploadAssetId: assetB, sortOrder: 1, isPrimary: false, altText: "Back" }
      ],
      variants: [
        { clientId: "base-product", name: "100g", price: 40, stock: 10, measurement: { unitGroup: "WEIGHT", quantityValue: 100, quantityUnit: "G", packType: "PACK" } },
        { clientId: "small", name: "50g", price: 20, stock: 10, measurement: { unitGroup: "WEIGHT", quantityValue: 50, quantityUnit: "G", packType: "PACK" } }
      ]
    });

    expect(response.product.images).toHaveLength(2);
    expect(response.product.variants).toHaveLength(1);
    expect(response.product.variants[0]).toMatchObject({
      isDefault: false,
      name: "50g",
      price: 20,
      stock: 10
    });
    expect(response.product.images[0].variantIds).toEqual([response.product.variants[0].id]);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(inventory.initializeCatalogInventory).toHaveBeenCalledWith(tx, expect.objectContaining({
      storeId,
      reason: "product_created"
    }));
    expect(tx.productVariant.create).not.toHaveBeenCalled();
    expect(tx.productImage.create).not.toHaveBeenCalled();
    expect(prisma.product.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("rejects variant-scoped images without a selected variant", async () => {
    const { prisma, service } = createHarness();

    await expect(service.create(auth(), draft({
      images: [
        { uploadAssetId: assetA, sortOrder: 0, isPrimary: true, imageScope: "VARIANT" }
      ]
    }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: "PRODUCT_VARIANT_IMAGE_ASSIGNMENT_REQUIRED" })
    });

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates a draft without images and skips image writes", async () => {
    const { prisma, tx, inventory, service } = createHarness({ assetCount: 0, assets: [] });

    const response = await service.create(auth(), {
      storeId,
      name: "Draft product",
      category: "Grocery",
      price: 10,
      stock: 5,
      reorderPoint: 1,
      measurement: { unitGroup: "COUNT", quantityValue: 1, quantityUnit: "PIECE", packType: "UNIT" },
      status: "Draft",
      images: [],
      variants: []
    });

    expect(response.product.images).toEqual([]);
    expect(response.product.variants).toHaveLength(1);
    expect(prisma.uploadAsset.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(inventory.initializeCatalogInventory).toHaveBeenCalledWith(tx, expect.objectContaining({
      storeId,
      reason: "product_created"
    }));
    expect(tx.productImage.createMany).not.toHaveBeenCalled();
    expect(tx.uploadAsset.updateMany).not.toHaveBeenCalled();
  });

  it("reuses the category cache across product saves", async () => {
    const { prisma, rbac, service } = createHarness();

    await service.create(auth(), draft({ images: [{ uploadAssetId: assetA, sortOrder: 0, isPrimary: true }] }));
    await service.create(auth(), draft({ images: [{ uploadAssetId: assetB, sortOrder: 0, isPrimary: true }] }));

    expect(prisma.category.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.category.create).not.toHaveBeenCalled();
    expect(prisma.store.findFirst).not.toHaveBeenCalled();
    expect(rbac.storeAuthorization).toHaveBeenCalledTimes(1);
  });

  it("rejects unattachable assets before opening the write transaction", async () => {
    const { prisma, service } = createHarness({ attachable: false });

    await expect(service.create(auth(), draft({
      images: [
        { uploadAssetId: assetA, sortOrder: 0, isPrimary: true },
        { uploadAssetId: assetB, sortOrder: 1, isPrimary: false }
      ]
    }))).rejects.toMatchObject({
      response: expect.objectContaining({ code: "UPLOAD_ASSET_NOT_ATTACHABLE" })
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects forbidden store access before category and asset work", async () => {
    const { prisma, service } = createHarness({ hasPermissions: false });

    await expect(service.create(auth(), draft())).rejects.toMatchObject({
      response: expect.objectContaining({ code: "PRODUCT_FORBIDDEN" })
    });
    expect(prisma.category.findUnique).not.toHaveBeenCalled();
    expect(prisma.category.create).not.toHaveBeenCalled();
    expect(prisma.uploadAsset.findMany).not.toHaveBeenCalled();
  });

  it("applies sparse name-only updates without image or variant graph rewrites", async () => {
    const existing = productWithRelations({ catalogVersion: 3 });
    const updated = productWithRelations({ catalogVersion: 4, name: "Chilli Powder" });
    const { prisma, tx, service } = createHarness({ existingProduct: existing, updatedProduct: updated });

    const response = await service.update(auth(), "product-1", {
      storeId,
      expectedCatalogVersion: 3,
      name: "Chilli Powder"
    });

    expect(response.product.name).toBe("Chilli Powder");
    expect(response.product.catalogVersion).toBe(4);
    expect(tx.product.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        name: "Chilli Powder",
        catalogVersion: { increment: 1 }
      }),
      where: expect.objectContaining({
        catalogVersion: 3,
        id: "product-1",
        storeId
      })
    }));
    expect(tx.productVariant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { name: "Chilli Powder" },
      where: { productId: "product-1", isDefault: true }
    }));
    expect(tx.productImage.deleteMany).not.toHaveBeenCalled();
    expect(tx.productImage.createMany).not.toHaveBeenCalled();
    expect(tx.productVariant.deleteMany).not.toHaveBeenCalled();
    expect(tx.productVariant.createMany).not.toHaveBeenCalled();
    expect(prisma.uploadAsset.findMany).not.toHaveBeenCalled();
    expect(prisma.category.findUnique).not.toHaveBeenCalled();
    expect(prisma.category.create).not.toHaveBeenCalled();
  });

  it("rejects sparse updates with a stale catalog version", async () => {
    const { tx, service } = createHarness({ existingProduct: productWithRelations({ catalogVersion: 4 }) });

    await expect(service.update(auth(), "product-1", {
      storeId,
      expectedCatalogVersion: 3,
      name: "Chilli Powder"
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: "PRODUCT_VERSION_CONFLICT" })
    });

    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it("treats an identical sparse retry after commit as already applied", async () => {
    const { tx, service } = createHarness({
      existingProduct: productWithRelations({ catalogVersion: 4, name: "Chilli Powder" })
    });

    const response = await service.update(auth(), "product-1", {
      storeId,
      expectedCatalogVersion: 3,
      name: "Chilli Powder"
    });

    expect(response.product).toMatchObject({
      name: "Chilli Powder",
      catalogVersion: 4,
      alreadyApplied: true
    });
    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.productVariant.updateMany).not.toHaveBeenCalled();
  });
});

function createHarness(options: {
  assetCount?: number;
  assets?: ReturnType<typeof uploadAsset>[];
  attachable?: boolean;
  hasPermissions?: boolean;
  existingProduct?: ReturnType<typeof productWithRelations>;
  updatedProduct?: ReturnType<typeof productWithRelations>;
} = {}) {
  const tx = {
    product: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => productRow(data)),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => productRow(data)),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: jest.fn(async () => options.updatedProduct ?? options.existingProduct ?? productWithRelations())
    },
    productVariant: {
      create: jest.fn(),
      createMany: jest.fn(async () => ({ count: 1 })),
      deleteMany: jest.fn(),
      updateMany: jest.fn(async () => ({ count: 1 }))
    },
    productImage: {
      create: jest.fn(),
      createMany: jest.fn(async () => ({ count: 1 })),
      deleteMany: jest.fn(),
      count: jest.fn(async () => 1)
    },
    productImageVariant: {
      createMany: jest.fn(async () => ({ count: 1 })),
      deleteMany: jest.fn()
    },
    uploadAsset: {
      updateMany: jest.fn(async () => ({ count: 1 }))
    }
  };
    const prisma = {
    store: {
      findFirst: jest.fn(async () => ({ id: storeId, status: StoreStatus.APPROVED }))
    },
    category: {
      create: jest.fn(async () => ({ id: "category-1", name: "Grocery" })),
      findUnique: jest.fn(async () => ({ id: "category-1", name: "Grocery" }))
    },
    uploadAsset: {
      findMany: jest.fn()
    },
    product: {
      findFirst: jest.fn(async () => options.existingProduct ?? productWithRelations()),
      findUniqueOrThrow: jest.fn(async () => options.updatedProduct ?? options.existingProduct ?? productWithRelations())
    },
    productImage: {
      count: jest.fn(async () => 1)
    },
    $queryRaw: jest.fn(async () => [{
      assetCount: options.attachable === false ? 0 : options.assetCount ?? 1,
      product: options.attachable === false ? null : productRow({}),
      assets: options.attachable === false ? [] : options.assets ?? [uploadAsset(assetA), uploadAsset(assetB)]
    }]),
    $transaction: jest.fn(async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx))
  };
  const rbac = {
    storeAuthorization: jest.fn(async () => ({
      permissions: [PERMISSIONS.PRODUCT_MANAGE],
      storeDeletedAt: null,
      storeExists: true,
      storeStatus: StoreStatus.APPROVED
    })),
    hasPermissions: jest.fn(() => options.hasPermissions ?? true)
  };
  const shops = {
    invalidateShopCaches: jest.fn()
  };
  const inventory = {
    initializeCatalogInventory: jest.fn(async () => ({ initialized: 1 }))
  };
  const service = new ProductsService(
    prisma as never,
    inventory as never,
    rbac as never,
    shops as never,
    {} as never
  );
  return { prisma, tx, inventory, rbac, shops, service };
}

function auth() {
  return {
    userId,
    sessionId: "session-1",
    tokenFamilyId: "family-1",
    roleCodes: [],
    permissions: [PERMISSIONS.PRODUCT_MANAGE],
    isPlatformAdmin: false,
    authzVersion: 1,
    user: {
      id: userId,
      email: "owner@example.com",
      fullName: null,
      avatarUrl: null,
      status: "ACTIVE",
      emailVerified: true,
      authzVersion: 1
    }
  } as never;
}

function draft(overrides: Partial<Parameters<ProductsService["create"]>[1]> = {}) {
  return {
    storeId,
    name: "Aachi chilli powder",
    category: "Grocery",
    subCategory: "Spices & Masala",
    productType: "Chilli Powder",
    price: 40,
    stock: 20,
    reorderPoint: 10,
    measurement: { unitGroup: "WEIGHT", quantityValue: 100, quantityUnit: "G", packType: "PACK" },
    status: "Published",
    images: [{ uploadAssetId: assetA, sortOrder: 0, isPrimary: true }],
    variants: [],
    ...overrides
  } as Parameters<ProductsService["create"]>[1];
}

function productRow(data: Record<string, unknown>) {
  return {
    id: data.id ?? "product-1",
    storeId: data.storeId ?? storeId,
    categoryId: data.categoryId ?? null,
    name: data.name ?? "Aachi chilli powder",
    sku: data.sku ?? null,
    subCategory: data.subCategory ?? null,
    productType: data.productType ?? null,
    description: data.description ?? null,
    seoTitle: data.seoTitle ?? null,
    seoDescription: data.seoDescription ?? null,
    price: data.price ?? 40,
    compareAtPrice: data.compareAtPrice ?? null,
    stock: data.stock ?? 20,
    reorderPoint: data.reorderPoint ?? 10,
    unitGroup: data.unitGroup ?? "WEIGHT",
    quantityValue: data.quantityValue ?? 100,
    quantityUnit: data.quantityUnit ?? "G",
    normalizedValue: data.normalizedValue ?? 100,
    normalizedUnit: data.normalizedUnit ?? "G",
    packType: data.packType ?? "PACK",
    pricePerBaseUnit: data.pricePerBaseUnit ?? 400,
    status: data.status ?? ProductStatus.DRAFT,
    imageUrl: data.imageUrl ?? null,
    catalogVersion: data.catalogVersion ?? 1,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function productWithRelations(data: Record<string, unknown> = {}) {
  const product = productRow(data);
  return {
    ...product,
    category: { id: "category-1", name: "Grocery" },
    variants: [variantRow({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      price: product.price,
      mrp: product.compareAtPrice,
      stock: product.stock,
      isDefault: true,
      position: 0
    })],
    images: []
  };
}

function variantRow(data: Record<string, unknown> = {}) {
  return {
    id: data.id ?? "variant-1",
    productId: data.productId ?? "product-1",
    name: data.name ?? "Aachi chilli powder",
    sku: data.sku ?? null,
    price: data.price ?? 40,
    mrp: data.mrp ?? null,
    costPrice: data.costPrice ?? null,
    pricePerBaseUnit: data.pricePerBaseUnit ?? 400,
    stock: data.stock ?? 20,
    stockOnHand: data.stockOnHand ?? data.stock ?? 20,
    stockReserved: data.stockReserved ?? 0,
    stockVersion: data.stockVersion ?? 1,
    unitGroup: data.unitGroup ?? "WEIGHT",
    quantityValue: data.quantityValue ?? 100,
    quantityUnit: data.quantityUnit ?? "G",
    normalizedValue: data.normalizedValue ?? 100,
    normalizedUnit: data.normalizedUnit ?? "G",
    packType: data.packType ?? "PACK",
    isDefault: data.isDefault ?? false,
    position: data.position ?? 0,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

function uploadAsset(id: string) {
  return {
    id,
    originalFilename: `${id}.jpg`,
    renditions: [{
      kind: UploadRenditionKind.CARD,
      secureUrl: `https://cdn.example.test/${id}/card.webp`,
      width: 640,
      height: 640,
      bytes: null,
      format: "webp"
    }]
  };
}
