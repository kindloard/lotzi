import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { RedisService } from "../../modules/redis/redis.service";

const DISTANCE_MATRIX_URL = "https://maps.googleapis.com/maps/api/distancematrix/json";
const DISTANCE_CACHE_TTL_SECONDS = 10 * 60;
const DISTANCE_MATRIX_BATCH_SIZE = 25;
const GOOGLE_TIMEOUT_MS = 1_200;

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface GoogleRouteDistance {
  distanceMeters: number;
  distanceText: string;
  durationSeconds: number | null;
  durationText: string | null;
}

interface DistanceMatrixResponse {
  status: string;
  error_message?: string;
  rows?: Array<{
    elements?: DistanceMatrixElement[];
  }>;
}

interface DistanceMatrixElement {
  status: string;
  distance?: {
    text: string;
    value: number;
  };
  duration?: {
    text: string;
    value: number;
  };
  duration_in_traffic?: {
    text: string;
    value: number;
  };
}

interface CachedDistanceMatrix {
  distances: Array<GoogleRouteDistance | null>;
  version: 1;
}

@Injectable()
export class GoogleMapsService {
  private readonly logger = new Logger(GoogleMapsService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService
  ) {}

  get isDistanceMatrixConfigured() {
    return Boolean(this.config.get<string>("GOOGLE_MAPS_API_KEY"));
  }

  async drivingDistances(origin: LatLng, destinations: LatLng[]): Promise<Array<GoogleRouteDistance | null> | null> {
    const apiKey = this.config.get<string>("GOOGLE_MAPS_API_KEY");
    if (!apiKey || destinations.length === 0) {
      return null;
    }

    const batches = chunk(destinations, DISTANCE_MATRIX_BATCH_SIZE);
    const results: Array<GoogleRouteDistance | null> = [];

    for (const batch of batches) {
      const batchResult = await this.drivingDistanceBatch(apiKey, origin, batch);
      if (!batchResult) {
        return null;
      }
      results.push(...batchResult);
    }

    return results;
  }

  private async drivingDistanceBatch(
    apiKey: string,
    origin: LatLng,
    destinations: LatLng[]
  ): Promise<Array<GoogleRouteDistance | null> | null> {
    const cacheKey = distanceCacheKey(origin, destinations);
    const cached = await this.readCache(cacheKey);
    if (cached) {
      return cached.distances;
    }

    const url = new URL(DISTANCE_MATRIX_URL);
    url.searchParams.set("origins", coordinatePair(origin));
    url.searchParams.set("destinations", destinations.map(coordinatePair).join("|"));
    url.searchParams.set("mode", "driving");
    url.searchParams.set("units", "metric");
    url.searchParams.set("departure_time", "now");
    url.searchParams.set("traffic_model", "best_guess");
    url.searchParams.set("key", apiKey);

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS)
      });
      if (!response.ok) {
        this.logger.warn(`Google Distance Matrix failed with HTTP ${response.status}.`);
        return null;
      }

      const payload = (await response.json()) as DistanceMatrixResponse;
      if (payload.status !== "OK") {
        this.logger.warn(`Google Distance Matrix status ${payload.status}: ${payload.error_message ?? "no message"}`);
        return null;
      }

      const elements = payload.rows?.[0]?.elements ?? [];
      const distances = destinations.map((_, index) => mapDistanceElement(elements[index]));

      await this.redis.setEx(
        cacheKey,
        DISTANCE_CACHE_TTL_SECONDS,
        JSON.stringify({ distances, version: 1 } satisfies CachedDistanceMatrix)
      );

      return distances;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Google Distance Matrix request failed: ${message}`);
      return null;
    }
  }

  private async readCache(key: string): Promise<CachedDistanceMatrix | null> {
    const raw = await this.redis.get(key);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as CachedDistanceMatrix;
      return parsed.version === 1 && Array.isArray(parsed.distances) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function mapDistanceElement(element: DistanceMatrixElement | undefined) {
  if (!element || element.status !== "OK" || !element.distance) {
    return null;
  }

  const duration = element.duration_in_traffic ?? element.duration ?? null;
  return {
    distanceMeters: element.distance.value,
    distanceText: element.distance.text,
    durationSeconds: duration?.value ?? null,
    durationText: duration?.text ?? null
  };
}

function coordinatePair(value: LatLng) {
  return `${roundCoordinate(value.latitude)},${roundCoordinate(value.longitude)}`;
}

function distanceCacheKey(origin: LatLng, destinations: LatLng[]) {
  const material = JSON.stringify({
    origin: coordinatePair(origin),
    destinations: destinations.map(coordinatePair)
  });
  return `shops:distance:google:v1:${createHash("sha1").update(material).digest("hex").slice(0, 32)}`;
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(5));
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
