import { Prisma } from "@prisma/client";
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
}

const googleMapsMock = {
  drivingDistances: jest.fn(async () => null)
};

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
    const service = new ShopsService(prisma as never, googleMapsMock as never, redis as never);

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
    const service = new ShopsService(prisma as never, googleMapsMock as never, redis as never);

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
    const service = new ShopsService(prisma as never, googleMaps as never, redis as never);

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
    const service = new ShopsService(prisma as never, googleMaps as never, redis as never);

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
});
