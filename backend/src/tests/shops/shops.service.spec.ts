import { Prisma, ProductStatus } from "@prisma/client";
import { ShopsService } from "../../modules/shops/shops.service";

class RedisMock {
  private readonly store = new Map<string, string>();

  get = jest.fn(async (key: string) => this.store.get(key) ?? null);
  setEx = jest.fn(async (key: string, _seconds: number, value: string) => {
    this.store.set(key, value);
  });
  del = jest.fn(async (key: string) => {
    this.store.delete(key);
  });
  delByPrefix = jest.fn(async (prefix: string) => {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  });
}

const googleMapsMock = {
  drivingDistances: jest.fn(async () => null)
};

function observabilityMock() {
  return {
    recordShopPageCacheEvent: jest.fn()
  };
}

describe("ShopsService", () => {
  it("returns slim approved shop DTOs from cache after the first Prisma load", async () => {
    const prisma = {
      store: {
        findMany: jest.fn(async () => [
          {
            id: "store-1",
            name: "Fresh Greens",
            slug: "fresh-greens",
            addressLine: "Main Road",
            latitude: new Prisma.Decimal("8.7012345"),
            longitude: new Prisma.Decimal("77.4012345"),
            isDeliveryAvailable: true,
            imageUrl: null,
            businessProfile: { category: "vegetables" },
            branding: {
              tagline: "Picked daily",
              description: "Local produce",
              primaryColor: "#16a34a",
              accentColor: "#f59e0b",
              logoMedia: { url: "https://res.cloudinary.com/demo/image/upload/logo.jpg" },
              bannerMedia: { url: "https://res.cloudinary.com/demo/image/upload/banner.jpg" }
            },
            products: [{ name: "Spinach" }]
          }
        ])
      },
      product: {
        findMany: jest.fn()
      }
    };
    const redis = new RedisMock();
    const service = new ShopsService(prisma as never, googleMapsMock as never, observabilityMock() as never, redis as never);

    const first = await service.listApprovedShops();
    const second = await service.listApprovedShops();

    expect(prisma.store.findMany).toHaveBeenCalledTimes(1);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.etag).toBe(first.etag);
    expect(second.data).toEqual([
      expect.objectContaining({
        id: "store-1",
        name: "Fresh Greens",
        type: "vegetables",
        typeName: "Vegetables",
        featuredProduct: "Spinach",
        distance: "Set location",
        distanceSource: "pending",
        distanceMeters: null,
        latitude: 8.7012345,
        longitude: 77.4012345,
        logoUrl: "https://res.cloudinary.com/demo/image/upload/logo.jpg",
        bannerUrl: "https://res.cloudinary.com/demo/image/upload/banner.jpg"
      })
    ]);
  });

  it("maps deal products with numeric prices and deterministic discounts", async () => {
    const prisma = {
      store: {
        findMany: jest.fn()
      },
      product: {
        findMany: jest.fn(async () => [
          {
            id: "prod-1",
            name: "Country Sourdough",
            price: new Prisma.Decimal("100.00"),
            compareAtPrice: new Prisma.Decimal("120.00"),
            imageUrl: null,
            category: { slug: "bakery" },
            store: { id: "store-1", name: "Daily Bakery" }
          }
        ])
      }
    };
    const redis = new RedisMock();
    const service = new ShopsService(prisma as never, googleMapsMock as never, observabilityMock() as never, redis as never);

    const result = await service.listDealProducts();

    expect(result.data).toEqual([
      expect.objectContaining({
        id: "prod-1",
        name: "Country Sourdough",
        price: 100,
        originalPrice: 120,
        shop: "Daily Bakery",
        shopId: "store-1",
        discount: "17% OFF",
        imageBg: "bg-rose-50 text-rose-800"
      })
    ]);
  });

  it("uses Google road distances when available and falls back to straight-line distance otherwise", async () => {
    const prisma = {
      store: {
        findMany: jest.fn(async () => [
          {
            id: "store-1",
            latitude: new Prisma.Decimal("8.7012345"),
            longitude: new Prisma.Decimal("77.4012345")
          },
          {
            id: "store-2",
            latitude: new Prisma.Decimal("8.7010000"),
            longitude: new Prisma.Decimal("77.4010000")
          }
        ])
      },
      product: {
        findMany: jest.fn()
      }
    };
    const googleMaps = {
      drivingDistances: jest.fn(async () => [
        {
          distanceMeters: 850,
          distanceText: "0.9 km",
          durationSeconds: 240,
          durationText: "4 mins"
        },
        null
      ])
    };
    const redis = new RedisMock();
    const service = new ShopsService(prisma as never, googleMaps as never, observabilityMock() as never, redis as never);

    const result = await service.listShopDistances(
      { latitude: 8.7, longitude: 77.4 },
      18
    );

    expect(googleMaps.drivingDistances).toHaveBeenCalledTimes(1);
    expect(result[0]).toEqual({
      shopId: "store-1",
      distance: "0.9 km",
      distanceMeters: 850,
      distanceAccuracyMeters: 18,
      distanceSource: "google_road",
      durationSeconds: 240,
      durationText: "4 mins"
    });
    expect(result[1]).toEqual(
      expect.objectContaining({
        shopId: "store-2",
        distance: "About 150 m away",
        distanceSource: "straight_line",
        distanceAccuracyMeters: 18
      })
    );
  });

  it("does not expose symbolic or over-precise distance labels for nearby stores", async () => {
    const prisma = {
      store: {
        findMany: jest.fn(async () => [
          {
            id: "store-nearby",
            latitude: new Prisma.Decimal("8.7001000"),
            longitude: new Prisma.Decimal("77.4001000")
          },
          {
            id: "store-walkable",
            latitude: new Prisma.Decimal("8.7006000"),
            longitude: new Prisma.Decimal("77.4000000")
          }
        ])
      },
      product: {
        findMany: jest.fn()
      }
    };
    const googleMaps = {
      drivingDistances: jest.fn(async () => null)
    };
    const redis = new RedisMock();
    const service = new ShopsService(prisma as never, googleMaps as never, observabilityMock() as never, redis as never);

    const result = await service.listShopDistances(
      { latitude: 8.7, longitude: 77.4 },
      25
    );

    expect(result[0]).toEqual(
      expect.objectContaining({
        shopId: "store-nearby",
        distance: "Nearby"
      })
    );
    expect(result[1]).toEqual(
      expect.objectContaining({
        shopId: "store-walkable",
        distance: "Within 100 m"
      })
    );
    expect(result.map((item) => item.distance).join(" ")).not.toContain("~");
    expect(result.map((item) => item.distance).join(" ")).not.toContain("-");
  });

  it("merges subcategory facet casing variants into one bucket", async () => {
    const productGroupBy = jest.fn(async (args: { by: string[] }) => {
      if (args.by[0] === "categoryId") {
        return [];
      }
      return [
        { subCategory: "Cooking Oils", _count: { _all: 2 } },
        { subCategory: "cooking oils", _count: { _all: 3 } },
        { subCategory: "Spices", _count: { _all: 1 } },
        { subCategory: null, _count: { _all: 10 } }
      ];
    });

    const prisma = {
      product: {
        findMany: jest.fn(async () => []),
        count: jest.fn(async () => 0),
        groupBy: productGroupBy
      },
      category: {
        findMany: jest.fn(async () => [])
      }
    };
    const service = new ShopsService(
      prisma as never,
      googleMapsMock as never,
      observabilityMock() as never,
      new RedisMock() as never
    );

    const response = await (service as never as {
      loadProductsForShopDetail: (
        detail: Record<string, unknown>,
        query: { category: string | null; includeFacets: boolean; limit: number; page: number; q: string; sort: "relevance" }
      ) => Promise<{ facets: { subCategories: Array<{ name: string; count: number }> } }>;
    }).loadProductsForShopDetail(shopDetailFixture(), {
      category: null,
      includeFacets: true,
      limit: 24,
      page: 1,
      q: "",
      sort: "relevance"
    });

    expect(response.facets.subCategories).toEqual([
      { name: "cooking oils", count: 5 },
      { name: "Spices", count: 1 }
    ]);
  });

  it("filters case-insensitive subcategory values when user selects a facet name", async () => {
    const records = [
      catalogProductFixture("prod-1", "Cooking Oils", "grocery"),
      catalogProductFixture("prod-2", "cooking oils", "grocery"),
      catalogProductFixture("prod-3", "Spices", "grocery")
    ];

    const productFindMany = jest.fn(async (args: { where?: Record<string, unknown> }) => {
      const target = selectedSubCategory(args.where);
      if (!target) {
        return records;
      }
      return records.filter((record) => record.subCategory?.toLowerCase() === target.toLowerCase());
    });

    const prisma = {
      product: {
        findMany: productFindMany,
        count: jest.fn(async (args: { where?: Record<string, unknown> }) => {
          const target = selectedSubCategory(args.where);
          return target
            ? records.filter((record) => record.subCategory?.toLowerCase() === target.toLowerCase()).length
            : records.length;
        }),
        groupBy: jest.fn(async (args: { by: string[]; where?: Record<string, unknown> }) => (args.by[0] === "categoryId" ? [] : []))
      },
      category: {
        findMany: jest.fn(async () => [])
      }
    };
    const service = new ShopsService(
      prisma as never,
      googleMapsMock as never,
      observabilityMock() as never,
      new RedisMock() as never
    );

    const response = await (service as never as {
      loadProductsForShopDetail: (
        detail: Record<string, unknown>,
        query: { category: string | null; includeFacets: boolean; limit: number; page: number; q: string; sort: "relevance" }
      ) => Promise<{ products: Array<{ id: string }> }>;
    }).loadProductsForShopDetail(shopDetailFixture(), {
      category: "Cooking Oils",
      includeFacets: true,
      limit: 24,
      page: 1,
      q: "",
      sort: "relevance"
    });

    expect(response.products.map((product) => product.id)).toEqual(["prod-1", "prod-2"]);
  });

  it("keeps legacy slug category URLs working through slug and de-slug matching", async () => {
    const records = [
      catalogProductFixture("prod-1", "Spices Masala", "grocery"),
      catalogProductFixture("prod-2", "Other", "spices-masala"),
      catalogProductFixture("prod-3", "Drinks", "grocery")
    ];

    const productFindMany = jest.fn(async (args: { where?: Record<string, unknown> }) => {
      const slugFilter = selectedSlugCategory(args.where);
      const rawSubCategory = selectedSubCategory(args.where);
      const deSlugged = selectedDeSluggedSubCategory(args.where);
      if (!slugFilter && !rawSubCategory && !deSlugged) {
        return records;
      }
      return records.filter((record) =>
        record.category?.slug === slugFilter ||
        record.subCategory?.toLowerCase() === (rawSubCategory ?? "").toLowerCase() ||
        record.subCategory?.toLowerCase() === (deSlugged ?? "").toLowerCase()
      );
    });

    const prisma = {
      product: {
        findMany: productFindMany,
        count: jest.fn(async () => 2),
        groupBy: jest.fn(async (args: { by: string[]; where?: Record<string, unknown> }) => (args.by[0] === "categoryId" ? [] : []))
      },
      category: {
        findMany: jest.fn(async () => [])
      }
    };
    const service = new ShopsService(
      prisma as never,
      googleMapsMock as never,
      observabilityMock() as never,
      new RedisMock() as never
    );

    const response = await (service as never as {
      loadProductsForShopDetail: (
        detail: Record<string, unknown>,
        query: { category: string | null; includeFacets: boolean; limit: number; page: number; q: string; sort: "relevance" }
      ) => Promise<{ products: Array<{ id: string }> }>;
    }).loadProductsForShopDetail(shopDetailFixture(), {
      category: "spices-masala",
      includeFacets: true,
      limit: 24,
      page: 1,
      q: "",
      sort: "relevance"
    });

    expect(response.products.map((product) => product.id)).toEqual(["prod-1", "prod-2"]);
  });

  it("builds facet queries with search retained and category removed", async () => {
    const productGroupBy = jest.fn(async (args: { by: string[]; where?: Record<string, unknown> }) => (args.by[0] === "categoryId" ? [] : []));
    const productFindMany = jest.fn(async () => []);

    const prisma = {
      product: {
        findMany: productFindMany,
        count: jest.fn(async () => 0),
        groupBy: productGroupBy
      },
      category: {
        findMany: jest.fn(async () => [])
      }
    };
    const service = new ShopsService(
      prisma as never,
      googleMapsMock as never,
      observabilityMock() as never,
      new RedisMock() as never
    );

    await (service as never as {
      loadProductsForShopDetail: (
        detail: Record<string, unknown>,
        query: { category: string | null; includeFacets: boolean; limit: number; page: number; q: string; sort: "relevance" }
      ) => Promise<unknown>;
    }).loadProductsForShopDetail(shopDetailFixture(), {
      category: "Cooking Oils",
      includeFacets: true,
      limit: 24,
      page: 1,
      q: "oil",
      sort: "relevance"
    });

    const categoryFacetCall = productGroupBy.mock.calls.find((call) => call[0]?.by?.[0] === "categoryId");
    const subCategoryFacetCall = productGroupBy.mock.calls.find((call) => call[0]?.by?.[0] === "subCategory");
    const firstFindManyCall = productFindMany.mock.calls[0] as Array<{ where?: Record<string, unknown> }> | undefined;
    const activeWhere = productFindWhere(firstFindManyCall?.[0]?.where);
    const facetWhere = productFindWhere(categoryFacetCall?.[0]?.where);
    const subFacetWhere = productFindWhere(subCategoryFacetCall?.[0]?.where);

    expect(selectedSubCategory(activeWhere)).toBe("Cooking Oils");
    expect(selectedSubCategory(facetWhere)).toBeNull();
    expect(selectedSubCategory(subFacetWhere)).toBeNull();
    expect(searchTerm(activeWhere)).toBe("oil");
    expect(searchTerm(facetWhere)).toBe("oil");
    expect(searchTerm(subFacetWhere)).toBe("oil");
  });
});

function productFindWhere(where: unknown) {
  return (where ?? {}) as { AND?: Array<Record<string, unknown>> };
}

function selectedSubCategory(where: unknown) {
  const and = productFindWhere(where).AND ?? [];
  const subCategoryClause = and.find((entry) => "subCategory" in entry && typeof entry.subCategory === "object");
  if (!subCategoryClause || typeof subCategoryClause.subCategory !== "object" || !subCategoryClause.subCategory) {
    return null;
  }
  return (subCategoryClause.subCategory as { equals?: string }).equals ?? null;
}

function selectedSlugCategory(where: unknown) {
  const and = productFindWhere(where).AND ?? [];
  const orClause = and.find((entry) => Array.isArray(entry.OR));
  if (!orClause || !Array.isArray(orClause.OR)) {
    return null;
  }
  const categorySlugClause = orClause.OR.find((entry) => entry?.category?.slug);
  return categorySlugClause?.category?.slug ?? null;
}

function selectedDeSluggedSubCategory(where: unknown) {
  const and = productFindWhere(where).AND ?? [];
  const orClause = and.find((entry) => Array.isArray(entry.OR));
  if (!orClause || !Array.isArray(orClause.OR)) {
    return null;
  }
  const subCategoryClauses = orClause.OR
    .map((entry) => entry?.subCategory?.equals)
    .filter((value): value is string => typeof value === "string");
  return subCategoryClauses.find((value) => value.includes(" ")) ?? null;
}

function searchTerm(where: unknown) {
  const and = productFindWhere(where).AND ?? [];
  const orClause = and.find((entry) => Array.isArray(entry.OR));
  if (!orClause || !Array.isArray(orClause.OR)) {
    return "";
  }
  const nameClause = orClause.OR.find((entry) => entry?.name?.contains);
  return nameClause?.name?.contains ?? "";
}

function shopDetailFixture() {
  return {
    id: "store-1",
    slug: "store-1",
    publicId: "123456",
    publicSlug: "store-1",
    name: "Test Shop",
    type: "grocery",
    typeName: "Grocery",
    description: null,
    tagline: null,
    phone: null,
    address: {
      line: null,
      city: "Nagercoil",
      state: "Tamil Nadu",
      pincode: null,
      latitude: null,
      longitude: null
    },
    isDeliveryAvailable: true,
    openingTime: null,
    closingTime: null,
    imageUrl: null,
    logoUrl: null,
    bannerUrl: null,
    tags: [],
    branding: {
      primaryColor: null,
      accentColor: null
    }
  };
}

function catalogProductFixture(id: string, subCategory: string, categorySlug: string) {
  return {
    id,
    name: `Product ${id}`,
    storeId: "store-1",
    isActive: true,
    status: ProductStatus.PUBLISHED,
    subCategory,
    productType: "",
    description: null,
    price: new Prisma.Decimal("100"),
    compareAtPrice: null,
    stock: 10,
    unitGroup: "COUNT",
    quantityValue: new Prisma.Decimal("1"),
    quantityUnit: "PIECE",
    packType: "UNIT",
    pricePerBaseUnit: new Prisma.Decimal("100"),
    imageUrl: null,
    category: {
      name: "Grocery",
      slug: categorySlug
    },
    images: [],
    variants: []
  };
}
