"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchShopProductDetail, type ShopProductDetailResponse } from "../shops-api";

export function shopProductDetailQueryKey(publicId: string, publicSlug: string, productRef: string) {
  return ["shops", "pdp", publicId, publicSlug, productRef] as const;
}

export function useShopProductDetail(
  publicId: string,
  publicSlug: string,
  productRef: string,
  initialData?: ShopProductDetailResponse
) {
  return useQuery({
    queryKey: shopProductDetailQueryKey(publicId, publicSlug, productRef),
    queryFn: ({ signal }) => fetchShopProductDetail(publicId, publicSlug, productRef, { signal }),
    initialData,
    staleTime: 2 * 60 * 1000
  });
}
