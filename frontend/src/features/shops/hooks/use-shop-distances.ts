"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchShopDistances, type Coordinates } from "../shops-api";

export function useShopDistances(coordinates: Coordinates | null) {
  return useQuery({
    queryKey: [
      "shops",
      "distances",
      coordinates ? roundCoordinate(coordinates.latitude) : null,
      coordinates ? roundCoordinate(coordinates.longitude) : null,
      coordinates?.accuracyMeters ? Math.round(coordinates.accuracyMeters) : null
    ],
    queryFn: ({ signal }) => {
      if (!coordinates) {
        return [];
      }
      return fetchShopDistances(coordinates, { signal });
    },
    enabled: Boolean(coordinates),
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1
  });
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(5));
}
