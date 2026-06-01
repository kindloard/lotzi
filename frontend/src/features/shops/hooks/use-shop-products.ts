"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  fetchShopCatalog,
  type FetchShopCatalogOptions,
  type ShopProductsFilters,
  type ShopProductsResponse
} from "../shops-api";
import { shopQueryKeys } from "../query-keys";

export function shopProductsQueryKey(
  publicId: string,
  publicSlug: string,
  filters: ShopProductsFilters,
  options?: FetchShopCatalogOptions
) {
  return shopQueryKeys.catalog(publicId, publicSlug, filters, options);
}

export function useShopProducts(
  publicId: string,
  publicSlug: string,
  filters: ShopProductsFilters,
  initialData?: ShopProductsResponse,
  options?: FetchShopCatalogOptions
) {
  return useQuery({
    queryKey: shopProductsQueryKey(publicId, publicSlug, filters, options),
    queryFn: ({ signal }) => fetchShopCatalog(publicId, publicSlug, filters, options, { signal }),
    initialData,
    placeholderData: keepPreviousData,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    staleTime: 0
  });
}
