import type { FetchShopCatalogOptions, ShopProductsFilters } from "./shops-api";

export const shopQueryKeys = {
  all: ["shops"] as const,
  catalogRoot: () => [...shopQueryKeys.all, "catalog"] as const,
  catalog: (
    publicId: string,
    publicSlug: string,
    filters: ShopProductsFilters,
    options?: FetchShopCatalogOptions
  ) => [
    ...shopQueryKeys.catalogRoot(),
    publicId,
    publicSlug,
    filters.q,
    filters.category ?? "",
    filters.sort,
    filters.page,
    filters.limit,
    options?.includeFacets === false ? "no-facets" : "with-facets"
  ] as const,
  deals: () => [...shopQueryKeys.all, "deal-products"] as const,
  list: () => [...shopQueryKeys.all, "list"] as const,
  nearby: (latKey: string | null, lngKey: string | null, radiusKm: number, limit: number, cursor: string | null = null) => [
    ...shopQueryKeys.all,
    "nearby",
    latKey,
    lngKey,
    radiusKm,
    limit,
    cursor ?? ""
  ] as const,
  pdpRoot: () => [...shopQueryKeys.all, "pdp"] as const,
  pdp: (publicId: string, publicSlug: string, productRef: string) => [
    ...shopQueryKeys.pdpRoot(),
    publicId,
    publicSlug,
    productRef
  ] as const
};
