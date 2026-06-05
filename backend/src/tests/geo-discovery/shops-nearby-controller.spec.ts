import { ShopsController } from "../../modules/shops/shops.controller";

function controllerWithGeo(nearby = jest.fn()) {
  return {
    controller: new ShopsController(
      {} as never,
      { nearby } as never,
      {} as never,
      {} as never
    ),
    nearby
  };
}

function responseMock() {
  return {
    removeHeader: jest.fn(),
    setHeader: jest.fn(),
    vary: jest.fn()
  };
}

function requestMock(headers: Record<string, string | undefined> = {}) {
  return {
    header: jest.fn((name: string) => headers[name.toLowerCase()]),
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" }
  };
}

const nearbyResult = {
  cacheHit: true,
  cacheSource: "l1" as const,
  data: {
    apiVersion: "v1" as const,
    radiusKm: 5,
    items: [],
    pageInfo: { limit: 24, hasNextPage: false, nextCursor: null }
  },
  timings: [{ name: "geo-total", durationMs: 2.4 }]
};

describe("ShopsController nearby discovery", () => {
  it("serves the public cell route as cookie-free shared cache", async () => {
    const { controller, nearby } = controllerWithGeo(jest.fn(async () => nearbyResult));
    const request = requestMock();
    const response = responseMock();

    await controller.nearbyCell("8.713", "77.422", "5", "24", undefined, request as never, response as never);

    expect(nearby).toHaveBeenCalledWith(expect.objectContaining({
      latGrid: "8.713",
      lngGrid: "77.422",
      publicCell: true
    }));
    expect(response.removeHeader).toHaveBeenCalledWith("Set-Cookie");
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "public, max-age=30, s-maxage=60, stale-while-revalidate=300"
    );
    expect(response.vary).toHaveBeenCalledWith("Accept-Encoding");
  });

  it("does not bind exact nearby cursors to per-request ids", async () => {
    const { controller, nearby } = controllerWithGeo(jest.fn(async () => nearbyResult));
    const request = requestMock({
      "x-request-id": "request-a",
      "x-device-id": undefined
    });
    const response = responseMock();

    await controller.nearby("8.7", "77.4", "24", undefined, request as never, response as never);

    expect(nearby).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: null
    }));
  });
});
