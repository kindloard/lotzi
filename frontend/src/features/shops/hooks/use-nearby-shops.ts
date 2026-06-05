"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNearbyShops, type Coordinates, type NearbyShopsResponse } from "../shops-api";
import { shopQueryKeys } from "../query-keys";
import {
  DEFAULT_NEARBY_RADIUS_KM,
  gridForCoordinates,
  nearbyCacheKey,
  rankNearbyResponse
} from "../lib/geo-grid";

const NEARBY_LIMIT = 24;
const NEARBY_STALE_MS = 120 * 1000;
const NEARBY_GC_MS = 30 * 60 * 1000;
const NEARBY_SESSION_TTL_MS = 5 * 60 * 1000;

export function useNearbyShops(coordinates: Coordinates | null, cursor: string | null = null) {
  const grid = useMemo(() => coordinates ? gridForCoordinates(coordinates) : null, [coordinates]);
  const storageKey = grid ? nearbyCacheKey(grid, DEFAULT_NEARBY_RADIUS_KM, NEARBY_LIMIT, cursor) : null;
  const cached = useMemo(
    () => storageKey && coordinates ? readNearbyCache(storageKey, coordinates) : null,
    [coordinates, storageKey]
  );
  const query = useQuery({
    queryKey: grid
      ? shopQueryKeys.nearby(grid.latGrid, grid.lngGrid, DEFAULT_NEARBY_RADIUS_KM, NEARBY_LIMIT, cursor)
      : shopQueryKeys.nearby(null, null, DEFAULT_NEARBY_RADIUS_KM, NEARBY_LIMIT, cursor),
    queryFn: ({ signal }) => {
      if (!coordinates) {
        throw new Error("Coordinates are required for nearby shop discovery.");
      }
      return fetchNearbyShops(
        coordinates,
        { cursor, limit: NEARBY_LIMIT, radiusKm: DEFAULT_NEARBY_RADIUS_KM },
        { signal }
      ).then((response) => rankNearbyResponse(response, coordinates));
    },
    enabled: Boolean(coordinates),
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.cachedAt,
    staleTime: NEARBY_STALE_MS,
    gcTime: NEARBY_GC_MS,
    placeholderData: (previousData) => previousData,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: 1
  });

  useEffect(() => {
    if (storageKey && query.data) {
      writeNearbyCache(storageKey, query.data);
    }
  }, [query.data, storageKey]);

  return query;
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
    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > NEARBY_SESSION_TTL_MS || !parsed.data) {
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
    sessionStorage.setItem(key, JSON.stringify({ cachedAt: Date.now(), data }));
  } catch {
    // Nearby discovery still works without storage.
  }
}
