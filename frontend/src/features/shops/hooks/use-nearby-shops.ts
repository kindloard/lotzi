"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNearbyShops, type Coordinates, type NearbyShopsResponse } from "../shops-api";
import { shopQueryKeys } from "../query-keys";
import {
  DEFAULT_NEARBY_RADIUS_KM,
  coordinatesCacheKey,
  gridForCoordinates,
  nearbyCacheKey,
  rankNearbyResponse
} from "../lib/geo-grid";
import { writeGeoGridCookie } from "../lib/geo-cookie";

const NEARBY_LIMIT = 24;
const NEARBY_STALE_MS = 120 * 1000;
const NEARBY_GC_MS = 30 * 60 * 1000;
const NEARBY_SESSION_TTL_MS = 60 * 1000;
const EMPTY_RESULT_MEMORY_TTL_MS = 15 * 1000;
const EXPANDABLE_RADIUS_KM = [5, 10, 15] as const;
const SUPPORTED_RADIUS_KM = new Set([3, 5, 10, 15]);

interface UseNearbyShopsOptions {
  initialData?: NearbyShopsResponse | null;
  initialDataUpdatedAt?: number;
  initialRadiusKm?: number;
}

export function useNearbyShops(
  coordinates: Coordinates | null,
  cursor: string | null = null,
  options: UseNearbyShopsOptions = {}
) {
  const grid = useMemo(() => coordinates ? gridForCoordinates(coordinates) : null, [coordinates]);
  const requestedInitialRadiusKm = normalizeInitialRadiusKm(options.initialRadiusKm);
  const gridKey = grid ? `${grid.latGrid}:${grid.lngGrid}` : null;
  const coordinateKey = coordinates ? coordinatesCacheKey(coordinates) : null;
  const initialRadiusKm = requestedInitialRadiusKm ?? DEFAULT_NEARBY_RADIUS_KM;
  const [effectiveRadiusKm, setEffectiveRadiusKm] = useState(initialRadiusKm);
  const storageKey = coordinates ? nearbyCacheKey(coordinates, effectiveRadiusKm, NEARBY_LIMIT, cursor) : null;
  const cached = useMemo(
    () => storageKey && coordinates ? readNearbyCache(storageKey, coordinates) : null,
    [coordinates, storageKey]
  );
  const initialNearby = useMemo(
    () => {
      if (!coordinates || !grid || cursor || !options.initialData) {
        return null;
      }
      if (options.initialRadiusKm !== effectiveRadiusKm) {
        return null;
      }
      const responseGrid = options.initialData.cache?.grid;
      if (responseGrid && (responseGrid.latGrid !== grid.latGrid || responseGrid.lngGrid !== grid.lngGrid)) {
        return null;
      }
      return {
        cachedAt: options.initialDataUpdatedAt ?? Date.now(),
        data: rankNearbyResponse(options.initialData, coordinates)
      };
    },
    [
      coordinates,
      cursor,
      effectiveRadiusKm,
      grid,
      options.initialData,
      options.initialDataUpdatedAt,
      options.initialRadiusKm
    ]
  );
  const seeded = initialNearby ?? cached;
  const hasFreshSeededNearby = Boolean(
    seeded && Date.now() - seeded.cachedAt <= NEARBY_STALE_MS
  );
  const query = useQuery({
    queryKey: coordinates
      ? shopQueryKeys.nearby(coordinates.latitude.toFixed(5), coordinates.longitude.toFixed(5), effectiveRadiusKm, NEARBY_LIMIT, cursor)
      : shopQueryKeys.nearby(null, null, effectiveRadiusKm, NEARBY_LIMIT, cursor),
    queryFn: ({ signal }) => {
      if (!coordinates) {
        throw new Error("Coordinates are required for nearby shop discovery.");
      }
      return fetchNearbyShops(
        coordinates,
        { cursor, limit: NEARBY_LIMIT, radiusKm: effectiveRadiusKm },
        { signal }
      ).then((response) => rankNearbyResponse(response, coordinates));
    },
    enabled: Boolean(coordinates),
    initialData: seeded?.data,
    initialDataUpdatedAt: seeded?.cachedAt,
    staleTime: nearbyStaleTime,
    gcTime: NEARBY_GC_MS,
    refetchOnMount: initialNearby ? true : !hasFreshSeededNearby,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    retry: 1
  });

  useEffect(() => {
    setEffectiveRadiusKm(initialRadiusKm);
  }, [coordinateKey, cursor, gridKey, initialRadiusKm]);

  useEffect(() => {
    if (storageKey && query.data) {
      writeNearbyCache(storageKey, query.data);
    }
  }, [query.data, storageKey]);

  useEffect(() => {
    if (grid && query.isSuccess && query.data) {
      writeGeoGridCookie(grid, DEFAULT_NEARBY_RADIUS_KM);
    }
  }, [grid, query.data, query.isSuccess]);

  const itemCount = query.data?.items.length ?? 0;
  const isExpandingRadius = Boolean(coordinates && query.isFetching && effectiveRadiusKm > DEFAULT_NEARBY_RADIUS_KM);
  const exhaustedRadiusSearch = Boolean(
    coordinates &&
    query.isSuccess &&
    itemCount === 0
  );
  const expansionOptions = EXPANDABLE_RADIUS_KM.filter((radiusKm) => radiusKm > effectiveRadiusKm);
  const expandRadius = useCallback((radiusKm: number) => {
    if (!SUPPORTED_RADIUS_KM.has(radiusKm) || radiusKm <= effectiveRadiusKm) {
      return;
    }
    setEffectiveRadiusKm(radiusKm);
  }, [effectiveRadiusKm]);

  return {
    ...query,
    effectiveRadiusKm,
    exhaustedRadiusSearch,
    expansionOptions,
    expandRadius,
    isExpandingRadius,
    canExpandRadius: exhaustedRadiusSearch && expansionOptions.length > 0
  };
}

function readNearbyCache(key: string, coordinates: Coordinates): { cachedAt: number; data: NearbyShopsResponse } | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { cachedAt?: unknown; data?: NearbyShopsResponse };
    const cachedAt = Number(parsed.cachedAt);
    if (
      !Number.isFinite(cachedAt) ||
      Date.now() - cachedAt > NEARBY_SESSION_TTL_MS ||
      !parsed.data ||
      !Array.isArray(parsed.data.items)
    ) {
      sessionStorage.removeItem(key);
      return null;
    }
    if (!parsed.data.items.length && !geoEmptyCacheEnabled()) {
      sessionStorage.removeItem(key);
      return null;
    }
    return {
      cachedAt,
      data: rankNearbyResponse(parsed.data, coordinates)
    };
  } catch {
    return null;
  }
}

function writeNearbyCache(key: string, data: NearbyShopsResponse) {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  try {
    if (!data.items.length && !geoEmptyCacheEnabled()) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, JSON.stringify({ cachedAt: Date.now(), data }));
  } catch {
    // Nearby discovery still works without storage.
  }
}

function geoEmptyCacheEnabled() {
  return booleanValue(process.env.NEXT_PUBLIC_HOME_GEO_EMPTY_CACHE_ENABLED, false);
}

function normalizeInitialRadiusKm(value: number | undefined) {
  return typeof value === "number" && value === DEFAULT_NEARBY_RADIUS_KM
    ? value
    : null;
}

function booleanValue(rawValue: string | undefined, fallback: boolean) {
  const value = rawValue?.trim().toLowerCase();
  if (!value) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  return fallback;
}

function nearbyStaleTime(query: { state: { data: unknown } }) {
  const data = query.state.data as NearbyShopsResponse | undefined;
  return data && Array.isArray(data.items) && data.items.length === 0
    ? EMPTY_RESULT_MEMORY_TTL_MS
    : NEARBY_STALE_MS;
}
