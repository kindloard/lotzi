import { apiFetch } from "@/lib/api";

export interface Shop {
  id: string;
  name: string;
  slug: string;
  distance: string;
  rating: string;
  reviews: string;
  type: string;
  typeName: string;
  deliveryTime: string;
  deliveryFee: string;
  imageBg: string;
  initials: string;
  featuredProduct: string;
  tags: string[];
  imageUrl: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceMeters: number | null;
  distanceAccuracyMeters: number | null;
  distanceSource: "pending" | "straight_line" | "google_road";
  durationSeconds: number | null;
  durationText: string | null;
  branding?: {
    tagline: string | null;
    description: string | null;
    primaryColor: string | null;
    accentColor: string | null;
  } | null;
}

export interface DealProduct {
  id: string;
  name: string;
  price: number;
  originalPrice: number | null;
  shop: string;
  shopId: string;
  discount: string | null;
  rating: string;
  imageBg: string;
  imageInitials: string;
  imageUrl: string | null;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracyMeters?: number | null;
}

export interface ShopDistance {
  shopId: string;
  distance: string;
  distanceMeters: number;
  distanceAccuracyMeters: number | null;
  distanceSource: "straight_line" | "google_road";
  durationSeconds: number | null;
  durationText: string | null;
}

export function fetchShops(_params?: { latitude?: number; longitude?: number }, init?: RequestInit) {
  return apiFetch<Shop[]>("/v1/shops", init);
}

export function fetchShopProducts(init?: RequestInit) {
  return apiFetch<DealProduct[]>("/v1/shops/products", init);
}

export function fetchShopDistances(coordinates: Coordinates, init?: RequestInit) {
  const params = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude)
  });
  if (coordinates.accuracyMeters != null) {
    params.set("accuracy", String(Math.round(coordinates.accuracyMeters)));
  }

  return apiFetch<ShopDistance[]>(`/v1/shops/distances?${params.toString()}`, init);
}

export function enrichShopsWithDistance(shops: Shop[], coordinates: Coordinates | null): Shop[] {
  if (!coordinates) {
    return shops;
  }

  return shops.map((shop) => {
    if (shop.latitude == null || shop.longitude == null) {
      return shop;
    }

    const distanceMeters = distanceInMeters(
      coordinates.latitude,
      coordinates.longitude,
      shop.latitude,
      shop.longitude
    );

    return {
      ...shop,
      distance: formatApproximateDistance(distanceMeters, coordinates.accuracyMeters ?? null),
      distanceMeters,
      distanceAccuracyMeters: coordinates.accuracyMeters ?? null,
      distanceSource: "straight_line"
    };
  });
}

export function mergeShopDistances(shops: Shop[], distances: ShopDistance[] | undefined): Shop[] {
  if (!distances?.length) {
    return shops;
  }

  const byShopId = new Map(distances.map((distance) => [distance.shopId, distance]));
  return shops.map((shop) => {
    const distance = byShopId.get(shop.id);
    return distance
      ? {
          ...shop,
          distance: distance.distance,
          distanceMeters: distance.distanceMeters,
          distanceAccuracyMeters: distance.distanceAccuracyMeters,
          distanceSource: distance.distanceSource,
          durationSeconds: distance.durationSeconds,
          durationText: distance.durationText
        }
      : shop;
  });
}

function distanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radiusMeters = 6_371_000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radiusMeters * c;
}

function formatApproximateDistance(distanceMeters: number, accuracyMeters: number | null) {
  const safeDistance = Number.isFinite(distanceMeters) ? Math.max(0, distanceMeters) : 0;
  const accuracy = accuracyMeters && Number.isFinite(accuracyMeters) && accuracyMeters > 0
    ? Math.max(accuracyMeters, 25)
    : 100;

  if (safeDistance <= Math.max(accuracy, 50)) {
    return "Nearby";
  }

  if (safeDistance < 100) {
    return "Within 100 m";
  }

  if (safeDistance < 1_000) {
    const bucket = accuracy > 100 ? 100 : 50;
    const roundedMeters = Math.max(100, Math.round(safeDistance / bucket) * bucket);
    return `About ${roundedMeters} m away`;
  }

  const bucket = safeDistance < 10_000 ? 100 : 1_000;
  const roundedMeters = Math.round(safeDistance / bucket) * bucket;
  const value = roundedMeters < 10_000
    ? (roundedMeters / 1_000).toFixed(1)
    : Math.round(roundedMeters / 1_000).toString();
  return `About ${value} km away`;
}

function toRadians(value: number) {
  return value * (Math.PI / 180);
}
