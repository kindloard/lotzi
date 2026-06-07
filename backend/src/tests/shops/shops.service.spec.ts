import { Prisma, ProductStatus, StoreStatus } from "@prisma/client";
import { ShopsService } from "../../modules/shops/shops.service";

class RedisMock {
  private readonly store = new Map<string, string>();

  get = jest.fn(async (key: string) => this.store.get(key) ?? null);
  getStrict = jest.fn(async (key: string) => this.store.get(key) ?? null);
  setEx = jest.fn(async (key: string, _seconds: number, value: string) => {
    this.store.set(key, value);
  });
  setExStrict = jest.fn(async (key: string, _seconds: number, value: string) => {
    this.store.set(key, value);
    return true;
  });
  setNxEx = jest.fn(async (key: string, _seconds: number, value: string) => {
    if (this.store.has(key)) {
      return false;
    }
    this.store.set(key, value);
    return true;
  });
  del = jest.fn(async (key: string) => {
    this.store.delete(key);
  });
  incr = jest.fn(async (key: string) => {
    const next = Number(this.store.get(key) ?? "0") + 1;
    this.store.set(key, String(next));
    return next;
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
    observeShopCatalogCacheHit: jest.fn(),
    observeShopCatalogPrewarm: jest.fn(),
    observeShopCatalogStage: jest.fn(),
    observeShopCatalogStampedeWait: jest.fn(),
    recordShopPageCacheEvent: jest.fn(),
    recordShopCatalogPrewarmFailure: jest.fn(),
    recordShopCatalogStampedeFallback: jest.fn(),
    setApprovedShopsAvailable: jest.fn()
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

  it("separates product and variant media in public product DTOs", async () => {
    const record = catalogProductWithVariantImagesFixture();
    const prisma = {
      product: {
        findMany: jest.fn(async () => [record]),
        count: jest.fn(async () => 1),
        groupBy: jest.fn()
      },
      category: {
        findMany: jest.fn()
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
      ) => Promise<{
        products: Array<{
          imageUrl: string | null;
          images: Array<{ id: string; mediaSource: "PRODUCT" | "VARIANT"; variantIds: string[]; variantSkuIds: string[] }>;
          variants: Array<{ id: string; images: Array<{ id: string; mediaSource: "PRODUCT" | "VARIANT"; variantIds: string[]; variantSkuIds: string[] }> }>;
        }>;
      }>;
    }).loadProductsForShopDetail(shopDetailFixture(), {
      category: null,
      includeFacets: false,
      limit: 24,
      page: 1,
      q: "",
      sort: "relevance"
    });

    expect(response.products[0].imageUrl).toBe("https://cdn.example.test/front.webp");
    expect(response.products[0].images).toEqual([
      expect.objectContaining({
        id: "image-front",
        mediaSource: "PRODUCT",
        variantIds: [],
        variantSkuIds: []
      })
    ]);
    expect(response.products[0].variants.find((variant) => variant.id === "variant-1l")?.images).toEqual([
      expect.objectContaining({
        id: "image-shared",
        mediaSource: "VARIANT",
        variantIds: ["variant-1l", "variant-500ml"],
        variantSkuIds: ["GW-1L", "GW-500"]
      })
    ]);
    expect(response.products[0].variants.find((variant) => variant.id === "variant-500ml")?.images).toEqual([
      expect.objectContaining({
        id: "image-500ml",
        mediaSource: "VARIANT",
        variantIds: ["variant-500ml"],
        variantSkuIds: ["GW-500"]
      }),
      expect.objectContaining({
        id: "image-shared",
        mediaSource: "VARIANT",
        variantIds: ["variant-1l", "variant-500ml"],
        variantSkuIds: ["GW-1L", "GW-500"]
      })
    ]);
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

  it("skips the count query when the first page is not full", async () => {
    const prisma = {
      product: {
        findMany: jest.fn(async () => [catalogProductWithVariantImagesFixture()]),
        count: jest.fn(async () => 1),
        groupBy: jest.fn()
      },
      category: {
        findMany: jest.fn()
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
      ) => Promise<{ pagination: { total: number } }>;
    }).loadProductsForShopDetail(shopDetailFixture(), {
      category: null,
      includeFacets: false,
      limit: 24,
      page: 1,
      q: "",
      sort: "relevance"
    });

    expect(prisma.product.count).not.toHaveBeenCalled();
    expect(response.pagination.total).toBe(1);
  });

  it("runs the count query when the first page is full", async () => {
    const records = Array.from({ length: 24 }, (_, index) =>
      catalogProductFixture(`prod-${index}`, "Spices", "grocery")
    );
    const prisma = {
      product: {
        findMany: jest.fn(async () => records),
        count: jest.fn(async () => 50),
        groupBy: jest.fn()
      },
      category: {
        findMany: jest.fn()
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
      ) => Promise<{ pagination: { total: number } }>;
    }).loadProductsForShopDetail(shopDetailFixture(), {
      category: null,
      includeFacets: false,
      limit: 24,
      page: 1,
      q: "",
      sort: "relevance"
    });

    expect(prisma.product.count).toHaveBeenCalledTimes(1);
    expect(response.pagination.total).toBe(50);
  });

  it("uses the lightweight catalog select when the rollout flag is enabled", async () => {
    const prisma = {
      product: {
        findMany: jest.fn(async () => [catalogProductWithVariantImagesFixture()]),
        count: jest.fn(async () => 1),
        groupBy: jest.fn()
      },
      category: {
        findMany: jest.fn()
      }
    };
    const service = new ShopsService(
      prisma as never,
      googleMapsMock as never,
      observabilityMock() as never,
      new RedisMock() as never,
      { get: jest.fn((key: string, fallback?: unknown) => key === "SHOP_CATALOG_CARD_SELECT_ENABLED" ? "true" : fallback) } as never
    );

    const response = await (service as never as {
      loadProductsForShopDetail: (
        detail: Record<string, unknown>,
        query: { category: string | null; includeFacets: boolean; limit: number; page: number; q: string; sort: "relevance" }
      ) => Promise<{ products: Array<{ images: unknown[]; variants: Array<{ images: unknown[] }> }> }>;
    }).loadProductsForShopDetail(shopDetailFixture(), {
      category: null,
      includeFacets: false,
      limit: 24,
      page: 1,
      q: "",
      sort: "relevance"
    });

    const firstCall = prisma.product.findMany.mock.calls[0] as Array<{ select: Record<string, unknown> }> | undefined;
    const select = firstCall?.[0]?.select as Record<string, { take?: number; select?: Record<string, unknown> }>;
    const imageSelect = select.images.select ?? {};
    const variantSelect = select.variants.select ?? {};
    expect(select.images.take).toBe(1);
    expect(imageSelect.variants).toBeUndefined();
    expect(variantSelect.inventorySummary).toBeUndefined();
    expect(response.products[0]?.images).toHaveLength(1);
    expect(response.products[0]?.variants[0]?.images).toEqual([]);
  });

  it("keeps the rich product select as the default rollout-safe path", async () => {
    const prisma = {
      product: {
        findMany: jest.fn(async () => [catalogProductWithVariantImagesFixture()]),
        count: jest.fn(async () => 1),
        groupBy: jest.fn()
      },
      category: {
        findMany: jest.fn()
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
      category: null,
      includeFacets: false,
      limit: 24,
      page: 1,
      q: "",
      sort: "relevance"
    });

    const firstCall = prisma.product.findMany.mock.calls[0] as Array<{ select: Record<string, unknown> }> | undefined;
    const select = firstCall?.[0]?.select as Record<string, { take?: number; select?: Record<string, unknown> }>;
    const imageSelect = select.images.select ?? {};
    const variantSelect = select.variants.select ?? {};
    expect(select.images.take).toBe(8);
    expect(imageSelect.variants).toBeDefined();
    expect(variantSelect.inventorySummary).toBeDefined();
  });

  it("uses one in-process DB loader for concurrent identical catalog cache misses", async () => {
    const prisma = {
      store: {
        findMany: jest.fn(async () => [storeDetailRowFixture()])
      },
      product: {
        findMany: jest.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return [catalogProductFixture("prod-1", "Spices", "grocery")];
        }),
        count: jest.fn(async () => 1),
        groupBy: jest.fn()
      },
      category: {
        findMany: jest.fn()
      }
    };
    const service = new ShopsService(
      prisma as never,
      googleMapsMock as never,
      observabilityMock() as never,
      new RedisMock() as never,
      { get: jest.fn((key: string, fallback?: unknown) => key === "SHOP_CATALOG_STAMPEDE_LOCK_ENABLED" ? "true" : fallback) } as never
    );

    await Promise.all([
      service.listProductsForShopByPublicRoute("871480", "auxi-store", {
        category: null,
        includeFacets: false,
        limit: 24,
        page: 1,
        q: "",
        sort: "relevance"
      }),
      service.listProductsForShopByPublicRoute("871480", "auxi-store", {
        category: null,
        includeFacets: false,
        limit: 24,
        page: 1,
        q: "",
        sort: "relevance"
      })
    ]);

    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
  });

  it("prewarms public shop detail and first-page product catalog", async () => {
    const service = new ShopsService(
      {} as never,
      googleMapsMock as never,
      observabilityMock() as never,
      new RedisMock() as never
    );
    const detailSpy = jest.spyOn(service, "getShopDetailByPublicRoute").mockResolvedValue({
      cacheHit: false,
      data: shopDetailFixture(),
      etag: "detail"
    });
    const productsSpy = jest.spyOn(service, "listProductsForShopByPublicRoute").mockResolvedValue({
      cacheHit: false,
      data: {
        facets: { categories: [], subCategories: [] },
        filters: {
          category: null,
          includeFacets: true,
          limit: 24,
          page: 1,
          q: "",
          sort: "relevance"
        },
        pagination: {
          hasNextPage: false,
          limit: 24,
          page: 1,
          total: 0,
          totalPages: 1
        },
        products: [],
        store: {
          id: "store-1",
          name: "Test Shop",
          publicId: "123456",
          publicSlug: "test-shop",
          slug: "test-shop"
        }
      },
      etag: "products"
    });

    await (service as never as {
      prewarmPublicShopCatalogCaches: (shops: Array<{ publicId: string; publicSlug: string }>, source: string) => Promise<void>;
    }).prewarmPublicShopCatalogCaches([
      { publicId: "123456", publicSlug: "test-shop" }
    ], "test");

    expect(detailSpy).toHaveBeenCalledTimes(1);
    expect(detailSpy).toHaveBeenCalledWith("123456", "test-shop");
    expect(productsSpy).toHaveBeenCalledTimes(1);
    expect(productsSpy).toHaveBeenCalledWith("123456", "test-shop", expect.objectContaining({
      includeFacets: true,
      limit: 24,
      page: 1
    }));
  });

  it("reuses cached facets across category-filtered catalog misses with the same search term", async () => {
    const productGroupBy = jest.fn(async (args: { by: string[] }) =>
      args.by[0] === "categoryId"
        ? []
        : [{ subCategory: "Cooking Oils", _count: { _all: 5 } }]
    );
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
    const callable = service as never as {
      loadProductsForShopDetail: (
        detail: Record<string, unknown>,
        query: { category: string | null; includeFacets: boolean; limit: number; page: number; q: string; sort: "relevance" }
      ) => Promise<{ facets: { subCategories: Array<{ name: string; count: number }> } }>;
    };

    const first = await callable.loadProductsForShopDetail(shopDetailFixture(), {
      category: "Cooking Oils",
      includeFacets: true,
      limit: 24,
      page: 1,
      q: "oil",
      sort: "relevance"
    });
    const second = await callable.loadProductsForShopDetail(shopDetailFixture(), {
      category: "Spices",
      includeFacets: true,
      limit: 24,
      page: 1,
      q: "oil",
      sort: "relevance"
    });

    expect(productGroupBy).toHaveBeenCalledTimes(2);
    expect(second.facets).toEqual(first.facets);
  });

  it("resolves public shop routes with the indexed public code", async () => {
    const prisma = {
      store: {
        findMany: jest.fn(async () => [storeDetailRowFixture()])
      }
    };
    const service = new ShopsService(
      prisma as never,
      googleMapsMock as never,
      observabilityMock() as never,
      new RedisMock() as never
    );

    const response = await (service as never as {
      loadShopDetailByPublicRoute: (publicId: string, publicSlug: string) => Promise<{ publicId: string }>;
    }).loadShopDetailByPublicRoute("123456", "test-shop");

    expect(prisma.store.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        deletedAt: null,
        publicCode: "123456",
        status: StoreStatus.APPROVED
      }
    }));
    expect(response.publicId).toBe("123456");
  });

  it("loads critical PDP data without recommendation or full shop-detail queries", async () => {
    const productPublicId = "56af3a937eb84c4f9ae5421e378fce16";
    const product = publicPdpProductFixture();
    const prisma = {
      product: {
        findFirst: jest.fn(async () => product),
        findMany: jest.fn()
      },
      store: {
        findMany: jest.fn(),
        findUnique: jest.fn()
      }
    };
    const service = new ShopsService(
      prisma as never,
      googleMapsMock as never,
      observabilityMock() as never,
      new RedisMock() as never
    );

    const response = await service.getProductDetailForShopByPublicRoute(
      "123456",
      "test-shop",
      productPublicId,
      { includeRecommendations: false }
    );

    expect(prisma.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "56af3a93-7eb8-4c4f-9ae5-421e378fce16",
        store: expect.objectContaining({
          publicCode: "123456",
          slug: "test-shop",
          status: StoreStatus.APPROVED
        })
      })
    }));
    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.store.findMany).not.toHaveBeenCalled();
    expect(prisma.store.findUnique).not.toHaveBeenCalled();
    expect(response.data.store.address).toEqual({ city: "Nagercoil", state: "Tamil Nadu" });
    expect(response.data.recommendations).toEqual([]);
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

function storeDetailRowFixture() {
  return {
    id: "store-1",
    slug: "test-shop",
    publicCode: "123456",
    name: "Test Shop",
    description: null,
    phone: null,
    addressLine: null,
    city: "Nagercoil",
    state: "Tamil Nadu",
    pincode: null,
    latitude: null,
    longitude: null,
    status: StoreStatus.APPROVED,
    deletedAt: null,
    isDeliveryAvailable: true,
    openingTime: null,
    closingTime: null,
    imageUrl: null,
    businessProfile: { category: "grocery" },
    branding: {
      tagline: null,
      description: null,
      primaryColor: null,
      accentColor: null,
      logoMedia: null,
      bannerMedia: null
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

function catalogProductWithVariantImagesFixture() {
  return {
    ...catalogProductFixture("prod-with-images", "Cooking Oils", "grocery"),
    images: [
      {
        id: "image-front",
        altText: "Gold Winner front",
        isPrimary: true,
        sortOrder: 0,
        variants: [],
        uploadAsset: {
          renditions: [
            {
              secureUrl: "https://cdn.example.test/front.webp",
              width: 640,
              height: 640
            }
          ]
        }
      },
      {
        id: "image-500ml",
        altText: "Gold Winner 500ml",
        isPrimary: false,
        sortOrder: 1,
        variants: [
          {
            productVariant: {
              id: "variant-500ml",
              sku: "GW-500"
            }
          }
        ],
        uploadAsset: {
          renditions: [
            {
              secureUrl: "https://cdn.example.test/500ml.webp",
              width: 640,
              height: 640
            }
          ]
        }
      },
      {
        id: "image-shared",
        altText: "Gold Winner variants",
        isPrimary: false,
        sortOrder: 2,
        variants: [
          {
            productVariant: {
              id: "variant-1l",
              sku: "GW-1L"
            }
          },
          {
            productVariant: {
              id: "variant-500ml",
              sku: "GW-500"
            }
          }
        ],
        uploadAsset: {
          renditions: [
            {
              secureUrl: "https://cdn.example.test/shared.webp",
              width: 640,
              height: 640
            }
          ]
        }
      }
    ],
    variants: [
      {
        id: "variant-1l",
        name: "1L Packet",
        price: new Prisma.Decimal("240"),
        mrp: null,
        stock: 10,
        stockOnHand: 10,
        stockReserved: 0,
        unitGroup: "VOLUME",
        quantityValue: new Prisma.Decimal("1"),
        quantityUnit: "L",
        packType: "PACKET",
        pricePerBaseUnit: new Prisma.Decimal("240"),
        isDefault: true,
        position: 0
      },
      {
        id: "variant-500ml",
        name: "500ml Packet",
        price: new Prisma.Decimal("140"),
        mrp: null,
        stock: 10,
        stockOnHand: 10,
        stockReserved: 0,
        unitGroup: "VOLUME",
        quantityValue: new Prisma.Decimal("500"),
        quantityUnit: "ML",
        packType: "PACKET",
        pricePerBaseUnit: new Prisma.Decimal("280"),
        isDefault: false,
        position: 1
      }
    ]
  };
}

function publicPdpProductFixture() {
  return {
    ...catalogProductWithVariantImagesFixture(),
    id: "56af3a93-7eb8-4c4f-9ae5-421e378fce16",
    name: "Gold Winner",
    seoTitle: null,
    seoDescription: null,
    store: {
      id: "store-1",
      slug: "test-shop",
      publicCode: "123456",
      name: "Test Shop",
      city: "Nagercoil",
      state: "Tamil Nadu",
      businessProfile: { category: "grocery" }
    }
  };
}
