import { GeoDiscoveryCacheService } from "../../modules/geo-discovery/geo-discovery-cache.service";

class RedisMock {
  isConfigured = true;
  isCircuitBreakerOpen = false;
  readonly values = new Map<string, string>();

  getStrict = jest.fn(async (key: string) => this.values.get(key) ?? null);
  setExStrict = jest.fn(async (key: string, _seconds: number, value: string) => {
    this.values.set(key, value);
    return true;
  });
  setNxEx = jest.fn(async (key: string, _seconds: number, value: string) => {
    if (this.values.has(key)) {
      return false;
    }
    this.values.set(key, value);
    return true;
  });
  del = jest.fn(async (key: string) => {
    this.values.delete(key);
  });
  incr = jest.fn(async (key: string) => {
    const next = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, String(next));
    return next;
  });
}

function observabilityMock() {
  return {
    recordGeoCacheHit: jest.fn(),
    recordGeoCacheMiss: jest.fn(),
    recordGeoEpochConflict: jest.fn(),
    recordGeoRedisDegraded: jest.fn(),
    recordGeoStaleServe: jest.fn()
  };
}

describe("GeoDiscoveryCacheService", () => {
  it("skips cache writes when the epoch changes during a DB query", async () => {
    const redis = new RedisMock();
    redis.values.set("geo:epoch:v1:global", "1");
    redis.values.set("geo:epoch:v1:location:5:12.912:80.123", "1");
    redis.values.set("geo:epoch:v1:card:5:12.912:80.123", "1");
    const observability = observabilityMock();
    const cache = new GeoDiscoveryCacheService(redis as never, observability as never);
    const context = await cache.getEpochContext({ latGrid: "12.912", lngGrid: "80.123" }, 5);
    const key = cache.cacheKey(context, { cursorHash: "first", limit: 24, responseVersion: 1 });

    redis.values.set("geo:epoch:v1:global", "2");

    await expect(cache.setIfEpochUnchanged(key, context, "{}")).resolves.toBe(false);
    expect(redis.values.get(key)).toBeUndefined();
    expect(observability.recordGeoEpochConflict).toHaveBeenCalledTimes(1);
  });

  it("uses bounded L1 cache in non-production when Redis is not configured", async () => {
    const redis = new RedisMock();
    redis.isConfigured = false;
    redis.setExStrict.mockResolvedValue(false);
    const observability = observabilityMock();
    const cache = new GeoDiscoveryCacheService(redis as never, observability as never);
    const context = await cache.getEpochContext({ latGrid: "12.912", lngGrid: "80.123" }, 5);
    const key = cache.cacheKey(context, { cursorHash: "first", limit: 24, responseVersion: 1 });

    await expect(cache.setIfEpochUnchanged(key, context, "{}")).resolves.toBe(true);
    await expect(cache.get(key)).resolves.toBe("{}");
    expect(observability.recordGeoRedisDegraded).toHaveBeenCalledWith("cache_set");
    expect(observability.recordGeoCacheHit).toHaveBeenCalledWith("l1");
    expect(observability.recordGeoStaleServe).not.toHaveBeenCalled();
  });

  it("uses bounded L1 cache in non-production when Redis is configured but circuit-open", async () => {
    const redis = new RedisMock();
    redis.isCircuitBreakerOpen = true;
    redis.setExStrict.mockResolvedValue(false);
    const observability = observabilityMock();
    const cache = new GeoDiscoveryCacheService(redis as never, observability as never);
    const context = await cache.getEpochContext({ latGrid: "12.912", lngGrid: "80.123" }, 5);
    const key = cache.cacheKey(context, { cursorHash: "first", limit: 24, responseVersion: 1 });

    await expect(cache.setIfEpochUnchanged(key, context, "{}")).resolves.toBe(true);
    await expect(cache.get(key)).resolves.toBe("{}");
    expect(observability.recordGeoRedisDegraded).toHaveBeenCalledWith("cache_set");
    expect(observability.recordGeoCacheHit).toHaveBeenCalledWith("l1");
    expect(observability.recordGeoStaleServe).not.toHaveBeenCalled();
  });

  it("scopes nearby response cache keys by limit and response version", async () => {
    const redis = new RedisMock();
    const observability = observabilityMock();
    const cache = new GeoDiscoveryCacheService(redis as never, observability as never);
    const context = await cache.getEpochContext({ latGrid: "12.912", lngGrid: "80.123" }, 5);

    const firstPage24 = cache.cacheKey(context, { cursorHash: "first", limit: 24, responseVersion: 1 });
    const firstPage48 = cache.cacheKey(context, { cursorHash: "first", limit: 48, responseVersion: 1 });
    const nextVersion = cache.cacheKey(context, { cursorHash: "first", limit: 24, responseVersion: 2 });

    expect(firstPage24).toContain("limit:24");
    expect(firstPage48).toContain("limit:48");
    expect(firstPage24).not.toEqual(firstPage48);
    expect(firstPage24).not.toEqual(nextVersion);
  });

  it("bumps location epochs without globally busting card-only cache keys", async () => {
    const redis = new RedisMock();
    const observability = observabilityMock();
    const cache = new GeoDiscoveryCacheService(redis as never, observability as never);

    await cache.bumpLocationEpochs({
      previous: { latitude: 12.9121, longitude: 80.1231 },
      next: { latitude: 12.9131, longitude: 80.1241 }
    });

    expect(redis.values.get("geo:epoch:v1:global")).toBeUndefined();
    expect(redis.values.get("geo:epoch:v1:location:5:12.913:80.124")).toBe("1");
    expect(redis.values.get("geo:epoch:v1:location:5:12.912:80.123")).toBe("1");
    expect(redis.values.get("geo:epoch:v1:card:5:12.913:80.124")).toBeUndefined();
  });

  it("bumps store-card epochs without globally invalidating location cells", async () => {
    const redis = new RedisMock();
    const observability = observabilityMock();
    const cache = new GeoDiscoveryCacheService(redis as never, observability as never);

    await cache.bumpStoreCardEpochs({ latitude: 12.9131, longitude: 80.1241 });

    expect(redis.values.get("geo:epoch:v1:global")).toBeUndefined();
    expect(redis.values.get("geo:epoch:v1:card:5:12.913:80.124")).toBe("1");
    expect(redis.values.get("geo:epoch:v1:location:5:12.913:80.124")).toBeUndefined();
  });
});
