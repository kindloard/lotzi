"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  fetchShopCatalog,
  type FetchShopCatalogOptions,
  type ShopProductsFilters,
  type ShopProductsResponse
} from "../shops-api";

export function shopProductsQueryKey(
  publicId: string,
  publicSlug: string,
  filters: ShopProductsFilters,
  options?: FetchShopCatalogOptions
) {
  return [
    "shops",
    "catalog",
    publicId,
    publicSlug,
    filters.q,
    filters.category ?? "",
    filters.sort,
    filters.page,
    filters.limit,
    options?.includeFacets === false ? "no-facets" : "with-facets"
  ] as const;
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
    staleTime: 5 * 60 * 1000
  });
}
