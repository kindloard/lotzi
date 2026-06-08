import type { Coordinates, NearbyShopsResponse } from "../shops-api";
import { DEFAULT_NEARBY_RADIUS_KM, type GeoGrid } from "./geo-grid";

export const GEO_GRID_COOKIE_NAME = "ns_geo_grid";
export const GEO_GRID_COOKIE_TTL_MS = 15 * 60 * 1000;
export const GEO_GRID_COOKIE_TTL_SECONDS = GEO_GRID_COOKIE_TTL_MS / 1000;
export const GEO_GRID_DRIFT_METERS = 1_000;

const COOKIE_VERSION = "v1";
const COOKIE_SIGNING_CONTEXT = "lotzi-home-geo-grid-v1";
const SUPPORTED_RADIUS_KM = new Set([3, 5, 10, 15]);

export interface ParsedGeoGridCookie {
  coordinates: Coordinates;
  grid: GeoGrid;
  issuedAt: number;
  radiusKm: number;
}

export interface InitialNearbyPayload {
  coordinates: Coordinates;
  data: NearbyShopsResponse;
  fetchedAt: number;
  grid: GeoGrid;
  radiusKm: number;
}

export function parseGeoGridCookie(value: string | undefined | null, now = Date.now()): ParsedGeoGridCookie | null {
  if (!value) {
    return null;
  }
  const parts = decodeURIComponent(value).split(":");
  if (parts.length !== 6 || parts[0] !== COOKIE_VERSION) {
    return null;
  }
  const [, latGrid, lngGrid, rawRadiusKm, rawIssuedAt, signature] = parts;
  const radiusKm = Number(rawRadiusKm);
  const issuedAt = Number(rawIssuedAt);
  if (
    !isValidGridValue(latGrid, -90, 90) ||
    !isValidGridValue(lngGrid, -180, 180) ||
    !SUPPORTED_RADIUS_KM.has(radiusKm) ||
    !Number.isInteger(issuedAt) ||
    issuedAt <= 0 ||
    now - issuedAt > GEO_GRID_COOKIE_TTL_MS
  ) {
    return null;
  }
  const material = `${COOKIE_VERSION}:${latGrid}:${lngGrid}:${radiusKm}:${issuedAt}`;
  if (signature !== signGeoCookie(material)) {
    return null;
  }
  return {
    coordinates: {
      latitude: Number(latGrid),
      longitude: Number(lngGrid),
      accuracyMeters: GEO_GRID_DRIFT_METERS
    },
    grid: { latGrid, lngGrid },
    issuedAt,
    radiusKm
  };
}

export function buildGeoGridCookieValue(grid: GeoGrid, radiusKm = DEFAULT_NEARBY_RADIUS_KM, issuedAt = Date.now()) {
  const safeRadiusKm = SUPPORTED_RADIUS_KM.has(radiusKm) ? radiusKm : DEFAULT_NEARBY_RADIUS_KM;
  const material = `${COOKIE_VERSION}:${grid.latGrid}:${grid.lngGrid}:${safeRadiusKm}:${issuedAt}`;
  return `${material}:${signGeoCookie(material)}`;
}

export function writeGeoGridCookie(grid: GeoGrid, radiusKm = DEFAULT_NEARBY_RADIUS_KM) {
  if (typeof document === "undefined") {
    return;
  }
  const secure = window.location.protocol === "https:" ? "Secure" : "";
  document.cookie = [
    `${GEO_GRID_COOKIE_NAME}=${encodeURIComponent(buildGeoGridCookieValue(grid, radiusKm))}`,
    `Max-Age=${GEO_GRID_COOKIE_TTL_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
    secure
  ].filter(Boolean).join("; ");
}

export function clearGeoGridCookie() {
  if (typeof document === "undefined") {
    return;
  }
  document.cookie = `${GEO_GRID_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Lax`;
}

export function coordinatesDriftedBeyondGrid(left: Coordinates | null, right: Coordinates | null) {
  if (!left || !right) {
    return false;
  }
  return haversineMeters(left, right) > GEO_GRID_DRIFT_METERS;
}

function isValidGridValue(value: string | undefined, min: number, max: number) {
  if (!value || !/^-?\d{1,3}\.\d{3}$/.test(value)) {
    return false;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max;
}

function signGeoCookie(material: string) {
  let hash = 2166136261;
  const input = `${COOKIE_SIGNING_CONTEXT}:${material}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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
