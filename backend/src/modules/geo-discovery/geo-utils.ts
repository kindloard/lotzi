import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export const GEO_GRID_PRECISION = 3;
export const GEO_GRID_CELL_BUFFER_METERS = 160;
export const GEO_CURSOR_TTL_MS = 10 * 60 * 1000;
export const GEO_DEFAULT_LIMIT = 24;
export const GEO_MAX_LIMIT = 48;
export const GEO_SUPPORTED_RADIUS_KM = [2, 5, 10, 25, 50] as const;

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

export interface GeoGrid {
  latGrid: string;
  lngGrid: string;
}

export interface GeoLocationChange {
  storeId: string;
  previous: GeoCoordinates | null;
  next: GeoCoordinates;
}

export function parseLatitude(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < -90 || parsed > 90) {
    throw new BadRequestException({
      apiVersion: "v1",
      code: "INVALID_COORDINATES",
      message: "latitude must be a finite number between -90 and 90."
    });
  }
  return normalizeCoordinate(parsed, -90, 90);
}

export function parseLongitude(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < -180 || parsed > 180) {
    throw new BadRequestException({
      apiVersion: "v1",
      code: "INVALID_COORDINATES",
      message: "longitude must be a finite number between -180 and 180."
    });
  }
  return normalizeCoordinate(parsed, -180, 180);
}

export function parseLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return GEO_DEFAULT_LIMIT;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > GEO_MAX_LIMIT) {
    throw new BadRequestException({
      apiVersion: "v1",
      code: "INVALID_LIMIT",
      message: `limit must be an integer between 1 and ${GEO_MAX_LIMIT}.`
    });
  }
  return parsed;
}

export function parseRadiusKm(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!GEO_SUPPORTED_RADIUS_KM.includes(parsed as typeof GEO_SUPPORTED_RADIUS_KM[number])) {
    throw new BadRequestException({
      apiVersion: "v1",
      code: "INVALID_RADIUS",
      message: `radiusKm must be one of ${GEO_SUPPORTED_RADIUS_KM.join(", ")}.`
    });
  }
  return parsed;
}

export function normalizeCoordinate(value: number, min: number, max: number): number {
  const rounded = Number(value.toFixed(7));
  return Math.min(max, Math.max(min, Object.is(rounded, -0) ? 0 : rounded));
}

export function gridForCoordinates(coordinates: GeoCoordinates): GeoGrid {
  return {
    latGrid: gridValue(coordinates.latitude),
    lngGrid: gridValue(coordinates.longitude)
  };
}

export function gridValue(value: number): string {
  return (Math.round(value * 10 ** GEO_GRID_PRECISION) / 10 ** GEO_GRID_PRECISION).toFixed(GEO_GRID_PRECISION);
}

export function parseGridValue(value: unknown, field: "latGrid" | "lngGrid"): string {
  const parsed = typeof value === "number" ? value : Number(value);
  const min = field === "latGrid" ? -90 : -180;
  const max = field === "latGrid" ? 90 : 180;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new BadRequestException({
      apiVersion: "v1",
      code: "INVALID_GEO_GRID",
      message: `${field} must be a finite ${GEO_GRID_PRECISION}-decimal grid coordinate.`
    });
  }
  return gridValue(parsed);
}

export function coordinatesFromGrid(grid: GeoGrid): GeoCoordinates {
  return {
    latitude: Number(grid.latGrid),
    longitude: Number(grid.lngGrid)
  };
}

export function radiusMeters(radiusKm: number): number {
  return radiusKm * 1000;
}

export function numberFromDb(value: Prisma.Decimal | number | string | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatApproximateDistance(distanceMeters: number): string {
  const safeDistance = Number.isFinite(distanceMeters) ? Math.max(0, distanceMeters) : 0;
  if (safeDistance <= 50) {
    return "Nearby";
  }
  if (safeDistance < 100) {
    return "Within 100 m";
  }
  if (safeDistance < 1_000) {
    const roundedMeters = Math.max(100, Math.round(safeDistance / 50) * 50);
    return `About ${roundedMeters} m away`;
  }
  const bucket = safeDistance < 10_000 ? 100 : 1_000;
  const roundedMeters = Math.round(safeDistance / bucket) * bucket;
  const value = roundedMeters < 10_000
    ? (roundedMeters / 1_000).toFixed(1)
    : Math.round(roundedMeters / 1_000).toString();
  return `${value.replace(/\.0$/, "")} km away`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
