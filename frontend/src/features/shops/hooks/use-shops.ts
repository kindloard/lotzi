"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchShops, type Shop } from "../shops-api";
import { shopQueryKeys } from "../query-keys";

export const shopsQueryKey = shopQueryKeys.list();

export function useShops(initialData?: Shop[]) {
  return useQuery({
    queryKey: shopsQueryKey,
    queryFn: ({ signal }) => fetchShops(undefined, { signal }),
    initialData: initialData && initialData.length > 0 ? initialData : undefined,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    retry: 2,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 5_000)
  });
}
