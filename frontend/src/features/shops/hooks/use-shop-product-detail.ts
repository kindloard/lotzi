"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchShopProductDetail, type ShopProductDetailResponse } from "../shops-api";
import { shopQueryKeys } from "../query-keys";

export function shopProductDetailQueryKey(publicId: string, publicSlug: string, productRef: string) {
  return shopQueryKeys.pdp(publicId, publicSlug, productRef);
}

export function useShopProductDetail(
  publicId: string,
  publicSlug: string,
  productRef: string,
  initialData?: ShopProductDetailResponse
) {
  return useQuery({
    queryKey: shopProductDetailQueryKey(publicId, publicSlug, productRef),
    queryFn: ({ signal }) => fetchShopProductDetail(
      publicId,
      publicSlug,
      productRef,
      { includeRecommendations: false },
      { signal }
    ),
    initialData,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 2 * 60 * 1000
  });
}
