import { GeoDiscoveryService } from "../../modules/geo-discovery/geo-discovery.service";

function serviceFixture(input: {
  candidates?: Array<{ id: string; distance_meters: number }>;
  hydratedStores?: Array<Record<string, unknown>>;
  approvedCount?: number;
  readModelEnabled?: boolean;
  readModelRows?: Array<Record<string, unknown>>;
} = {}) {
  const prisma = {
    $queryRaw: jest.fn(async () => input.readModelRows ?? input.candidates ?? []),
    store: {
      count: jest.fn(async () => input.approvedCount ?? 1),
      findMany: jest.fn(async () => input.hydratedStores ?? [])
    }
  };
  const cache = {
    acquireLoadLock: jest.fn(async () => true),
    cacheKey: jest.fn(() => "geo:cache:key"),
    cursorHash: jest.fn(() => "first"),
    getEpochContext: jest.fn(async (grid, radiusKm) => ({
      cardEpoch: "1",
      cellEpoch: "1",
      globalEpoch: "1",
      grid,
      locationEpoch: "1",
      radiusKm
    })),
    getWithSource: jest.fn(async () => null),
    releaseLoadLock: jest.fn(async () => undefined),
    setIfEpochUnchanged: jest.fn(async () => true),
    getStoreCards: jest.fn(async () => new Map()),
    setStoreCard: jest.fn(async () => undefined)
  };
  const observability = {
    observeGeoQuery: jest.fn(),
    observeGeoSearch: jest.fn(),
    observeShopsReturned: jest.fn(),
    observeStoreCardCacheHitRatio: jest.fn(),
    recordEmptyShopResult: jest.fn(),
    recordGeoFilterRejection: jest.fn(),
    recordGeoRadiusExpansion: jest.fn(),
    setApprovedShopsAvailable: jest.fn()
  };
  const service = new GeoDiscoveryService(
    prisma as never,
    cache as never,
    { verify: jest.fn(), sign: jest.fn() } as never,
    { consume: jest.fn(async () => ({ allowed: true })) } as never,
    { assess: jest.fn(async () => "allow") } as never,
    observability as never,
    {
      get: jest.fn((key: string, fallback: unknown) =>
        key === "SHOP_DISCOVERY_CARD_READ_MODEL_ENABLED"
          ? input.readModelEnabled ?? fallback
          : fallback
      )
    } as never
  );

  return { cache, observability, prisma, service };
}

describe("GeoDiscoveryService observability", () => {
  it("records radius rejections and empty-shop results when no candidates match", async () => {
    const { observability, service } = serviceFixture({ candidates: [], approvedCount: 1 });

    const result = await service.nearby({
      ip: "127.0.0.1",
      latGrid: "8.713",
      limit: "24",
      lngGrid: "77.422",
      publicCell: true,
      radiusKm: "5"
    });

    expect(result.data.items).toEqual([]);
    expect(observability.recordGeoFilterRejection).toHaveBeenCalledWith("radius", 5);
    expect(observability.observeShopsReturned).toHaveBeenCalledWith("nearby", 0);
    expect(observability.recordEmptyShopResult).toHaveBeenCalledWith({
      approvedAvailable: true,
      radiusKm: 5,
      source: "nearby"
    });
    expect(observability.setApprovedShopsAvailable).toHaveBeenCalledWith(1);
  });

  it("records hydration misses when candidate stores cannot be loaded into cards", async () => {
    const { observability, prisma, service } = serviceFixture({
      approvedCount: 1,
      candidates: [{ id: "5537fb23-d009-454f-9d85-444c26195e86", distance_meters: 34 }],
      hydratedStores: []
    });

    const result = await service.nearby({
      ip: "127.0.0.1",
      latGrid: "8.713",
      limit: "24",
      lngGrid: "77.422",
      publicCell: true,
      radiusKm: "5"
    });

    expect(prisma.store.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        deletedAt: null,
        status: "APPROVED"
      })
    }));
    expect(result.data.items).toEqual([]);
    expect(observability.recordGeoFilterRejection).toHaveBeenCalledWith("hydration_missing", 5);
    expect(observability.observeStoreCardCacheHitRatio).toHaveBeenCalledWith(0);
  });

  it("records expanded radius requests for rollout observability", async () => {
    const { observability, service } = serviceFixture({ candidates: [], approvedCount: 1 });

    await service.nearby({
      ip: "127.0.0.1",
      latGrid: "8.713",
      limit: "24",
      lngGrid: "77.422",
      publicCell: true,
      radiusKm: "10"
    });

    expect(observability.recordGeoRadiusExpansion).toHaveBeenCalledWith(5, 10);
  });

  it("uses the shop discovery read model without nested store hydration when flagged on", async () => {
    const { prisma, service } = serviceFixture({
      readModelEnabled: true,
      readModelRows: [{
        store_id: "5537fb23-d009-454f-9d85-444c26195e86",
        public_code: "871480",
        public_slug: "auxi-store",
        name: "Auxi store",
        slug: "auxi-store",
        type: "grocery",
        type_name: "Grocery",
        lat: 8.7127673,
        lng: 77.4218043,
        delivery_time: "Self Pickup",
        delivery_fee: "No delivery",
        image_url: null,
        logo_url: null,
        banner_url: null,
        featured_product: "palm oil",
        branding_json: {
          tagline: "best shop for grocery",
          description: "Modern grocery store",
          primaryColor: "#0f766e",
          accentColor: "#f59e0b"
        },
        business_hours_json: null,
        distance_meters: 34
      }]
    });

    const result = await service.nearby({
      ip: "127.0.0.1",
      latGrid: "8.713",
      limit: "24",
      lngGrid: "77.422",
      publicCell: true,
      radiusKm: "5"
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.store.findMany).not.toHaveBeenCalled();
    expect(result.data.items[0]).toMatchObject({
      id: "5537fb23-d009-454f-9d85-444c26195e86",
      name: "Auxi store",
      publicId: "871480",
      distanceMeters: 34,
      featuredProduct: "palm oil"
    });
  });
});
