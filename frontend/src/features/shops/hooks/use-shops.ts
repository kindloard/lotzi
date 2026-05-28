"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchShops, type Shop } from "../shops-api";

export const shopsQueryKey = ["shops", "list"] as const;

export function useShops(initialData?: Shop[]) {
  return useQuery({
    queryKey: shopsQueryKey,
    queryFn: ({ signal }) => fetchShops(undefined, { signal }),
    initialData: initialData && initialData.length > 0 ? initialData : undefined,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 5_000)
  });
}
