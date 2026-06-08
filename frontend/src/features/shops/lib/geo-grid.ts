import type { Coordinates, NearbyShopsResponse, Shop } from "../shops-api";

export const GEO_GRID_PRECISION = 3;
export const DEFAULT_NEARBY_RADIUS_KM = 3;

export interface GeoGrid {
  latGrid: string;
  lngGrid: string;
}

export function gridForCoordinates(coordinates: Coordinates): GeoGrid {
  return {
    latGrid: gridValue(coordinates.latitude),
    lngGrid: gridValue(coordinates.longitude)
  };
}

export function coordinatesCacheKey(coordinates: Coordinates) {
  return `${coordinates.latitude.toFixed(5)}:${coordinates.longitude.toFixed(5)}`;
}

export function nearbyCacheKey(coordinates: Coordinates, radiusKm: number, limit: number, cursor: string | null) {
  return `ns:shops:nearby:v3:${coordinatesCacheKey(coordinates)}:${radiusKm}:${limit}:${cursor ?? "first"}`;
}

export function rankNearbyResponse(response: NearbyShopsResponse, coordinates: Coordinates): NearbyShopsResponse {
  const radiusMeters = response.radiusKm * 1000;
  const items = response.items
    .map((shop) => withExactDistance(shop, coordinates))
    .filter((shop) => shop.distanceMeters != null && shop.distanceMeters <= radiusMeters)
    .sort((left, right) => (left.distanceMeters ?? Number.POSITIVE_INFINITY) - (right.distanceMeters ?? Number.POSITIVE_INFINITY));

  return {
    ...response,
    items
  };
}

function withExactDistance(shop: Shop, coordinates: Coordinates): Shop {
  if (shop.latitude == null || shop.longitude == null) {
    return shop;
  }
  const distanceMeters = Math.max(0, Math.round(haversineMeters(coordinates, {
    latitude: shop.latitude,
    longitude: shop.longitude
  })));
  return {
    ...shop,
    distance: formatApproximateDistance(distanceMeters),
    distanceMeters,
    distanceAccuracyMeters: coordinates.accuracyMeters ?? null,
    distanceSource: "straight_line"
  };
}

function gridValue(value: number) {
  return (Math.round(value * 10 ** GEO_GRID_PRECISION) / 10 ** GEO_GRID_PRECISION).toFixed(GEO_GRID_PRECISION);
}

function haversineMeters(origin: Pick<Coordinates, "latitude" | "longitude">, target: Pick<Coordinates, "latitude" | "longitude">) {
  const earthRadiusMeters = 6_371_000;
  const lat1 = radians(origin.latitude);
  const lat2 = radians(target.latitude);
  const deltaLat = radians(target.latitude - origin.latitude);
  const deltaLng = radians(target.longitude - origin.longitude);
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function radians(value: number) {
  return value * Math.PI / 180;
}

function formatApproximateDistance(distanceMeters: number) {
  if (distanceMeters <= 50) {
    return "Nearby";
  }
  if (distanceMeters < 100) {
    return "Within 100 m";
  }
  if (distanceMeters < 1_000) {
    const roundedMeters = Math.max(100, Math.round(distanceMeters / 50) * 50);
    return `About ${roundedMeters} m away`;
  }
  const bucket = distanceMeters < 10_000 ? 100 : 1_000;
  const roundedMeters = Math.round(distanceMeters / bucket) * bucket;
  const value = roundedMeters < 10_000
    ? (roundedMeters / 1_000).toFixed(1)
    : Math.round(roundedMeters / 1_000).toString();
  return `${value.replace(/\.0$/, "")} km away`;
}
