"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchNearbyShops, type Coordinates } from "../shops-api";
import { shopQueryKeys } from "../query-keys";

export function useNearbyShops(coordinates: Coordinates | null, cursor: string | null = null) {
  return useQuery({
    queryKey: coordinates
      ? shopQueryKeys.nearby(
          roundCoordinate(coordinates.latitude),
          roundCoordinate(coordinates.longitude),
          cursor
        )
      : shopQueryKeys.nearby(null, null, cursor),
    queryFn: ({ signal }) => {
      if (!coordinates) {
        throw new Error("Coordinates are required for nearby shop discovery.");
      }
      return fetchNearbyShops(coordinates, { cursor, limit: 24 }, { signal });
    },
    enabled: Boolean(coordinates),
    staleTime: 15 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    retry: 1
  });
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(3));
}
