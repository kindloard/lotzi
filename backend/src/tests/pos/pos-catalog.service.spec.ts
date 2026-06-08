import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Prisma, ProductStatus, ProductVariantStatus, StoreStatus } from "@prisma/client";
import { PosCatalogService } from "../../modules/pos/pos-catalog/pos-catalog.service";
import { PERMISSIONS } from "../../modules/rbac/permissions";

const storeId = "3b9b5c65-8ebf-4a7f-8d0c-d08cc30c7626";
const userId = "db519c83-4d31-4f12-8fa5-75a7bb6dc3d4";

describe("PosCatalogService", () => {
  it("loads an initial DB-backed catalog when the query is empty", async () => {
    const { prisma, service } = createHarness({
      variants: [variantRow({ name: "1kg", productName: "Idly Rice", price: "72.50" })]
    });

    const response = await service.listProducts(auth(), storeId, { query: "" });

    expect(prisma.productVariant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 80,
      where: {
        product: {
          storeId,
          isActive: true
        },
        status: ProductVariantStatus.ACTIVE
      }
    }));
    expect(response).toMatchObject({
      apiVersion: "v1",
      source: "database",
      query: "",
      count: 1,
      results: [
        {
          name: "Idly Rice 1kg",
          price: 72.5,
          availableStock: 8,
          categoryName: "Grocery"
        }
      ]
    });
  });

  it("normalizes search text and searches product plus variant identifiers", async () => {
    const { prisma, service } = createHarness({
      variants: [variantRow({ sku: "RICE-1KG" })]
    });

    await service.searchProducts(auth(), storeId, "  rice   1kg  ");

    expect(prisma.productVariant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 20,
      where: expect.objectContaining({
        OR: [
          { sku: { contains: "rice 1kg", mode: "insensitive" } },
          { name: { contains: "rice 1kg", mode: "insensitive" } },
          { product: { sku: { contains: "rice 1kg", mode: "insensitive" } } },
          { product: { name: { contains: "rice 1kg", mode: "insensitive" } } }
        ]
      })
    }));
  });

  it("rejects users without store read permission before querying products", async () => {
    const { prisma, service } = createHarness({ permissions: [] });

    await expect(service.listProducts(auth(), storeId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
  });

  it("rejects stores that are deleted or unavailable before querying products", async () => {
    const { prisma, service } = createHarness({ storeDeletedAt: new Date().toISOString() });

    await expect(service.listProducts(auth(), storeId)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
  });
});

function createHarness(input: {
  variants?: ReturnType<typeof variantRow>[];
  permissions?: string[];
  storeDeletedAt?: string | null;
} = {}) {
  const prisma = {
    productVariant: {
      count: jest.fn().mockResolvedValue(input.variants?.length ?? 0),
      findMany: jest.fn().mockResolvedValue(input.variants ?? [])
    },
    store: {
      findFirst: jest.fn().mockResolvedValue({ id: storeId })
    }
  };
  const rbac = {
    storeAuthorization: jest.fn().mockResolvedValue({
      storeId,
      roleCodes: ["STORE_STAFF"],
      permissions: input.permissions ?? [PERMISSIONS.STORE_READ],
      isPlatformAdmin: false,
      storeExists: true,
      storeDeletedAt: input.storeDeletedAt ?? null,
      storeStatus: StoreStatus.APPROVED
    }),
    hasPermissions: jest.fn((actual: string[], required: string[]) =>
      required.every((permission) => actual.includes(permission))
    )
  };

  return {
    prisma,
    rbac,
    service: new PosCatalogService(prisma as never, rbac as never)
  };
}

function auth() {
  return {
    userId,
    sessionId: "session-id",
    tokenFamilyId: "token-family-id",
    roleCodes: ["STORE_STAFF"],
    permissions: [PERMISSIONS.STORE_READ],
    isPlatformAdmin: false,
    authzVersion: 1,
    user: {
      id: userId,
      email: "staff@example.com",
      fullName: "Staff",
      avatarUrl: null,
      status: "ACTIVE",
      emailVerified: true,
      authzVersion: 1
    }
  } as never;
}

function variantRow(input: {
  name?: string;
  productName?: string;
  sku?: string | null;
  price?: string;
} = {}) {
  return {
    id: "variant-1",
    productId: "product-1",
    name: input.name ?? "Default",
    sku: input.sku ?? null,
    price: new Prisma.Decimal(input.price ?? "45.00"),
    mrp: null,
    stock: 10,
    stockOnHand: 10,
    stockReserved: 2,
    stockVersion: 1,
    unitGroup: "COUNT",
    quantityValue: new Prisma.Decimal("1"),
    quantityUnit: "PIECE",
    normalizedValue: new Prisma.Decimal("1"),
    normalizedUnit: "PIECE",
    packType: "UNIT",
    pricePerBaseUnit: new Prisma.Decimal(input.price ?? "45.00"),
    isDefault: true,
    position: 0,
    product: {
      id: "product-1",
      name: input.productName ?? "Idly Rice",
      sku: "RICE",
      categoryId: "category-1",
      imageUrl: "https://assets.example/rice.jpg",
      status: ProductStatus.PUBLISHED,
      category: {
        id: "category-1",
        name: "Grocery",
        slug: "grocery"
      }
    }
  };
}
