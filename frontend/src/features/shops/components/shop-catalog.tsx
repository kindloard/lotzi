"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { memo, type MouseEvent, useCallback, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Heart, Minus, Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { useCart } from "@/lib/cart-context";
import { optimizedCloudinaryUrl } from "../lib/image-utils";
import { SearchInput } from "@/components/search-input";
import { ViewImageViewer, type ViewImageItem } from "@/components/view-image-viewer";
import { useShopProducts } from "../hooks/use-shop-products";
import { fetchShopProductDetail } from "../shops-api";
import type { ShopDetail, ShopProduct, ShopProductVariant, ShopProductsFilters, ShopProductsResponse } from "../shops-api";
import { shopProductDetailQueryKey } from "../hooks/use-shop-product-detail";
import { canonicalProductPath, productRefFromParts } from "../lib/product-route";
import { buildSubCategoryLabels, localizeCategoryLabel, localizeSubCategoryLabel } from "../lib/category-labels";
import { useCatalogRealtimeSubscription } from "../realtime/catalog-realtime";
import { Link, useRouter } from "@/i18n/navigation";

const CATEGORY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface ShopCatalogProps {
  shop: ShopDetail;
  initialProducts: ShopProductsResponse;
  initialFailed?: boolean;
  initialFilters: ShopProductsFilters;
}

export function ShopCatalog({
  shop,
  initialProducts,
  initialFailed = false,
  initialFilters
}: ShopCatalogProps) {
  const pathname = usePathname();
  const router = useRouter();
  const format = useFormatter();
  const tCatalog = useTranslations("marketplace.shopCatalog");
  const tCategories = useTranslations("marketplace.categories");
  const subCategoryLabels = useMemo(() => buildSubCategoryLabels(tCatalog), [tCatalog]);
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState(initialFilters);
  const [pendingProduct, setPendingProduct] = useState<ShopProduct | null>(null);
  const [viewerPayload, setViewerPayload] = useState<{
    images: ViewImageItem[];
    index: number;
    title: string;
  } | null>(null);
  const { addToCart, cartItems, clearCart, updateQty } = useCart();
  const isLocalCatalogMode = initialProducts.pagination.total <= initialProducts.pagination.limit;
  const shouldFetchFacets = !filters.category;
  const catalogFetchOptions = isLocalCatalogMode
    ? { includeFacets: true }
    : { includeFacets: shouldFetchFacets };

  const updateFilters = useCallback((next: Partial<ShopProductsFilters>) => {
    setFilters((current) => {
      const merged = { ...current, ...next };
      const params = new URLSearchParams(window.location.search);
      if (merged.q) {
        params.set("q", merged.q);
      } else {
        params.delete("q");
      }
      if (merged.category) {
        params.set("category", merged.category);
      } else {
        params.delete("category");
      }
      if (merged.sort !== "relevance") {
        params.set("sort", merged.sort);
      } else {
        params.delete("sort");
      }
      if (merged.page > 1) {
        params.set("page", String(merged.page));
      } else {
        params.delete("page");
      }
      if (merged.limit > 0 && merged.limit !== 24) {
        params.set("limit", String(merged.limit));
      } else {
        params.delete("limit");
      }

      window.history.replaceState(null, "", params.toString() ? `${pathname}?${params.toString()}` : pathname);
      return merged;
    });
  }, [pathname]);

  const queryFilters = isLocalCatalogMode ? initialFilters : filters;
  const initialDataForQuery = !initialFailed && filtersEqual(queryFilters, initialFilters)
    ? initialProducts
    : undefined;
  const query = useShopProducts(
    shop.publicId,
    shop.publicSlug,
    queryFilters,
    initialDataForQuery,
    catalogFetchOptions
  );
  const remoteData = query.data ?? initialProducts;
  const data = isLocalCatalogMode ? buildLocalCatalogData(initialProducts, filters) : remoteData;
  const visibleProductPublicIds = useMemo(() => data.products.map((product) => product.publicId), [data.products]);
  useCatalogRealtimeSubscription({
    enabled: true,
    productPublicIds: visibleProductPublicIds,
    storePublicId: shop.publicId
  });
  const showProductError = !isLocalCatalogMode && (query.isError || (initialFailed && !query.data && !query.isFetching));
  const hasCrossStoreItems = cartItems.some((item) => item.shopId !== shop.id);
  const cartByProductId = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const item of cartItems) {
      quantities.set(item.id, (quantities.get(item.id) ?? 0) + item.qty);
    }
    return quantities;
  }, [cartItems]);
  const cartByLineKey = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const item of cartItems) {
      const key = item.variantId ?? item.id;
      quantities.set(key, (quantities.get(key) ?? 0) + item.qty);
    }
    return quantities;
  }, [cartItems]);
  const formatPrice = useCallback(
    (value: number) =>
      format.number(value, {
        currency: "INR",
        maximumFractionDigits: value % 1 === 0 ? 0 : 2,
        style: "currency"
      }),
    [format]
  );
  const resultText = tCatalog("resultCount", { count: data.pagination.total });
  const facetSource = useMemo(() => {
    if (isLocalCatalogMode) {
      return data.facets;
    }
    if ((remoteData.facets.subCategories?.length ?? 0) > 0 || (remoteData.facets.categories?.length ?? 0) > 0) {
      return remoteData.facets;
    }
    return initialProducts.facets;
  }, [data.facets, initialProducts.facets, isLocalCatalogMode, remoteData.facets]);
  const categoryFacets = useMemo(() => {
    const subCategories = (facetSource.subCategories ?? [])
      .filter((item) => Boolean(item.name?.trim()) && item.count > 0)
      .map((item) => ({
        count: item.count,
        key: `sub:${item.name}`,
        label: localizeSubCategoryLabel(item.name, subCategoryLabels),
        value: item.name
      }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.label.localeCompare(right.label);
      });

    if (subCategories.length) {
      return subCategories;
    }

    return (facetSource.categories ?? [])
      .filter((item) => Boolean(item.slug) && Boolean(item.name) && item.count > 0)
      .map((item) => ({
        count: item.count,
        key: `cat:${item.slug}`,
        label: localizeCategoryLabel(item.slug, item.name, tCategories),
        value: item.slug
      }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.label.localeCompare(right.label);
      });
  }, [facetSource.categories, facetSource.subCategories, subCategoryLabels, tCategories]);

  function requestAdd(product: ShopProduct) {
    if (!getPurchasableCatalogVariant(product)) {
      return;
    }
    if (hasCrossStoreItems) {
      setPendingProduct(product);
      return;
    }
    addProduct(product);
  }

  function addProduct(product: ShopProduct) {
    const variant = getPurchasableCatalogVariant(product);
    if (!variant) {
      return;
    }
    addToCart({
      id: product.id,
      variantId: variant.id,
      name: product.name,
      price: variant.price,
      shop: shop.name,
      shopId: shop.id,
      imageBg: "bg-slate-50 text-slate-900",
      imageInitials: product.imageInitials,
      imageUrl: product.imageUrl ?? undefined,
      unit: variant.unitDisplay,
      unitDisplay: variant.unitDisplay,
      pricePerBaseUnitDisplay: variant.pricePerBaseUnitDisplay
    });
  }

  function confirmReplaceCart() {
    if (!pendingProduct) {
      return;
    }
    clearCart();
    addProduct(pendingProduct);
    setPendingProduct(null);
  }

  function openProductImageViewer(product: ShopProduct, imageIndex = 0) {
    const images = getProductViewerImages(product);
    if (!images.length) {
      return;
    }

    const startIndex = Math.min(Math.max(imageIndex, 0), images.length - 1);
    setViewerPayload({
      images,
      index: startIndex,
      title: product.name
    });
  }

  const warmProductRoute = useCallback((product: ShopProduct) => {
    const productRef = productRefFromParts(product.publicId, product.slug);
    const href = canonicalProductPath(shop.publicId, shop.publicSlug, product.publicId, product.slug);
    router.prefetch(href);
    void queryClient.prefetchQuery({
      queryKey: shopProductDetailQueryKey(shop.publicId, shop.publicSlug, productRef),
      queryFn: ({ signal }) => fetchShopProductDetail(shop.publicId, shop.publicSlug, productRef, { signal }),
      staleTime: 0
    });
  }, [queryClient, router, shop.publicId, shop.publicSlug]);

  return (
    <section className="space-y-6" aria-labelledby="shop-catalog-title">
      <div className="py-4 md:py-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 md:px-0">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <SearchInput
              initialValue={filters.q}
              shopName={shop.name}
              onSearch={(q) => updateFilters({ q, page: 1 })}
            />
          </div>

          <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide" aria-label={tCatalog("productCategories")}>
            <CategoryButton
              active={!filters.category}
              label={tCatalog("all")}
              onClick={() => updateFilters({ category: null, page: 1 })}
            />
            {categoryFacets.map((category) => (
              <CategoryButton
                key={category.key}
                active={filters.category === category.value}
                label={`${category.label} (${category.count})`}
                onClick={() => updateFilters({ category: category.value, page: 1 })}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto flex min-h-[56dvh] max-w-6xl flex-col px-4 pb-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="shop-catalog-title" className="text-xl font-black tracking-tight text-slate-950">
            {tCatalog("title")}
          </h2>
          <p className="text-sm font-semibold text-slate-500" aria-live="polite">
            {query.isFetching ? tCatalog("updatingProducts") : resultText}
          </p>
        </div>

        {showProductError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-950">
            {tCatalog("loadError")}
            <button
              type="button"
              onClick={() => query.refetch()}
              className="ml-2 rounded-md bg-black px-3 py-1.5 text-white"
            >
              {tCatalog("retry")}
            </button>
          </div>
        ) : data.products.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {data.products.map((product, index) => (
              <ProductCard
                key={product.id}
                product={product}
                priority={index < 6}
                qty={cartByLineKey.get(getCatalogDisplayVariant(product)?.id ?? product.id) ?? cartByProductId.get(product.id) ?? 0}
                onAdd={() => requestAdd(product)}
                onPrefetch={() => warmProductRoute(product)}
                onPreviewImage={(imageIndex) => openProductImageViewer(product, imageIndex)}
                onQtyChange={(delta) => updateQty(getCatalogDisplayVariant(product)?.id ?? product.id, delta)}
                labels={{
                  addButton: tCatalog("addButton"),
                  addToCart: (name) => tCatalog("addToCartAria", { name }),
                  decreaseQuantity: (name) => tCatalog("decreaseQuantity", { name }),
                  favorite: tCatalog("favorite"),
                  increaseQuantity: (name) => tCatalog("increaseQuantity", { name }),
                  outOfStock: tCatalog("outOfStock"),
                  viewImage: (name) => tCatalog("viewImage", { name })
                }}
                formatPrice={formatPrice}
                productHref={canonicalProductPath(shop.publicId, shop.publicSlug, product.publicId, product.slug)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-base font-black text-slate-950">{tCatalog("emptyTitle")}</p>
            <p className="mt-2 text-sm font-medium text-slate-500">
              {tCatalog("emptyDescription")}
            </p>
          </div>
        )}

        {data.pagination.totalPages > 1 ? (
          <div className="mt-auto flex items-center justify-center gap-3 pt-8">
            <button
              type="button"
              disabled={data.pagination.page <= 1}
              onClick={() => updateFilters({ page: Math.max(1, data.pagination.page - 1) })}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-bold text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={16} />
              {tCatalog("previous")}
            </button>
            <span className="text-sm font-bold text-slate-500">
              {tCatalog("pageStatus", { page: data.pagination.page, totalPages: data.pagination.totalPages })}
            </span>
            <button
              type="button"
              disabled={!data.pagination.hasNextPage}
              onClick={() => updateFilters({ page: data.pagination.page + 1 })}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-bold text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {tCatalog("next")}
              <ChevronRight size={16} />
            </button>
          </div>
        ) : null}
      </div>

      {pendingProduct ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-4 sm:items-center sm:justify-center" role="dialog" aria-modal="true" aria-labelledby="replace-cart-title">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 id="replace-cart-title" className="text-lg font-black text-slate-950">
              {tCatalog("replaceCartTitle")}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {tCatalog("replaceCartDescription")}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPendingProduct(null)}
                className="h-11 rounded-lg border border-slate-300 text-sm font-black text-slate-800"
              >
                {tCatalog("cancel")}
              </button>
              <button
                type="button"
                onClick={confirmReplaceCart}
                className="h-11 rounded-lg bg-black text-sm font-black text-white"
              >
                {tCatalog("replaceCart")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {viewerPayload ? (
        <ViewImageViewer
          images={viewerPayload.images}
          initialIndex={viewerPayload.index}
          isOpen={Boolean(viewerPayload)}
          onClose={() => setViewerPayload(null)}
          title={viewerPayload.title}
        />
      ) : null}
    </section>
  );
}

function CategoryButton({
  active,
  label,
  onClick
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-10 shrink-0 rounded-full border px-5 text-sm font-bold transition-all duration-200 ${
        active
          ? "border-black bg-black text-white shadow-md shadow-black/20"
          : "border-slate-200 bg-white text-slate-600"
      }`}
    >
      {label}
    </button>
  );
}

const ProductCard = memo(function ProductCard({
  formatPrice,
  labels,
  product,
  priority,
  qty,
  onAdd,
  onPrefetch,
  onPreviewImage,
  productHref,
  onQtyChange
}: {
  formatPrice: (value: number) => string;
  labels: ProductCardLabels;
  product: ShopProduct;
  priority: boolean;
  qty: number;
  onAdd: () => void;
  onPrefetch: () => void;
  onPreviewImage: (imageIndex: number) => void;
  productHref: string;
  onQtyChange: (delta: number) => void;
}) {
  const router = useRouter();
  const catalogImage = getPreferredCatalogImage(product);
  const imageUrl = optimizedCloudinaryUrl(catalogImage?.url ?? product.imageUrl, { width: 360 });
  const hasViewerImage = Boolean(catalogImage?.url || product.imageUrl);
  const displayVariant = getCatalogDisplayVariant(product);
  const purchasableVariant = getPurchasableCatalogVariant(product);
  const displayInStock = Boolean(purchasableVariant);
  const availableStock = purchasableVariant?.stock ?? 0;
  const quantityAtLimit = displayInStock && qty >= availableStock;
  const price = formatPrice(displayVariant?.price ?? product.price);
  const compareAt = displayVariant?.compareAtPrice ? formatPrice(displayVariant.compareAtPrice) : null;
  const unitDisplay = displayVariant?.unitDisplay ?? product.unitDisplay;

  function handleCardClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button,a,input,textarea,select,label")) {
      return;
    }
    router.push(productHref);
  }

  return (
    <article
      className={`group relative flex h-full flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_2px_8px_-3px_rgba(0,0,0,0.05)] transition ${
        displayInStock ? "border-slate-100" : "border-slate-200 bg-slate-50/80"
      }`}
      onClick={handleCardClick}
      onFocus={onPrefetch}
      onPointerEnter={onPrefetch}
      onTouchStart={onPrefetch}
    >
      <button
        type="button"
        className="relative h-[130px] w-full overflow-hidden bg-slate-50/50 p-2 text-left sm:h-[150px] sm:p-3 disabled:cursor-default"
        disabled={!hasViewerImage}
        onClick={() => onPreviewImage(0)}
        aria-label={labels.viewImage(product.name)}
      >
        {!displayInStock ? (
          <span className="absolute left-3 top-3 z-10 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-rose-600 shadow-sm ring-1 ring-rose-100">
            {labels.outOfStock}
          </span>
        ) : null}
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={catalogImage?.altText ?? product.name}
            fill
            priority={priority}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            className={`object-contain p-4 mix-blend-multiply transition ${displayInStock ? "" : "grayscale opacity-60"}`}
          />
        ) : (
          <span className={`flex h-full items-center justify-center text-lg font-black ${displayInStock ? "text-slate-300" : "text-slate-400"}`}>
            {product.imageInitials}
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={productHref}
            prefetch
            className="min-w-0"
            onFocus={onPrefetch}
            onPointerEnter={onPrefetch}
            onTouchStart={onPrefetch}
          >
            <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-bold leading-snug text-slate-800">
              {product.name}
            </h3>
          </Link>
          <button type="button" aria-label={labels.favorite} className="text-slate-900 shrink-0 mt-0.5">
            <Heart size={16} strokeWidth={3} />
          </button>
        </div>
        
        <p className="mt-1 text-xs font-medium text-slate-500">
          {unitDisplay}
        </p>
        
        <div className="mt-auto flex items-end justify-between gap-2 pt-4">
          <div className="flex flex-col">
            <span className="text-base font-black tracking-tight text-slate-900">{price}</span>
            {compareAt ? (
              <span className="text-[11px] font-semibold text-slate-400 line-through">{compareAt}</span>
            ) : null}
          </div>

          {displayInStock ? (
            qty > 0 ? (
              <div className="flex h-9 w-[76px] items-center justify-between rounded-lg bg-black text-white shadow-sm overflow-hidden transition-all">
                <button
                  type="button"
                  onClick={() => onQtyChange(-1)}
                  className="flex h-full w-7 items-center justify-center"
                  aria-label={labels.decreaseQuantity(product.name)}
                >
                  <Minus size={14} strokeWidth={2.5} />
                </button>
                <span className="flex-1 text-center text-sm font-bold leading-none">{qty}</span>
                <button
                  type="button"
                  onClick={() => onQtyChange(1)}
                  disabled={quantityAtLimit}
                  className="flex h-full w-7 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={labels.increaseQuantity(product.name)}
                >
                  <Plus size={14} strokeWidth={2.5} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onAdd}
                disabled={!displayInStock}
                className="flex h-9 w-[76px] items-center justify-center rounded-lg bg-black text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                aria-label={labels.addToCart(product.name)}
              >
                {labels.addButton}
              </button>
            )
          ) : (
            <span className="rounded-lg bg-rose-50 px-2.5 py-1.5 text-[11px] font-bold text-rose-500">
              {labels.outOfStock}
            </span>
          )}
        </div>
      </div>
    </article>
  );
});

type ProductCardLabels = {
  addButton: string;
  addToCart: (name: string) => string;
  decreaseQuantity: (name: string) => string;
  favorite: string;
  increaseQuantity: (name: string) => string;
  outOfStock: string;
  viewImage: (name: string) => string;
};

function getProductViewerImages(product: ShopProduct): ViewImageItem[] {
  const seen = new Set<string>();
  const images: ViewImageItem[] = [];
  const visibleProductImages = getCatalogVisibleImages(product);

  if (!visibleProductImages.length) {
    const fallbackUrl = optimizedCloudinaryUrl(product.imageUrl, { width: 1600 });
    if (fallbackUrl) {
      images.push({
        id: `${product.id}:primary`,
        src: fallbackUrl,
        alt: product.name
      });
    }
    return images;
  }

  for (const image of visibleProductImages) {
    const optimized = optimizedCloudinaryUrl(image.url, { width: 1600 });
    if (!optimized || seen.has(optimized)) {
      continue;
    }
    seen.add(optimized);
    images.push({
      id: image.id,
      src: optimized,
      alt: image.altText ?? product.name,
      width: image.width,
      height: image.height
    });
  }

  return images;
}

function getPreferredCatalogImage(product: ShopProduct) {
  return getCatalogVisibleImages(product)[0] ?? null;
}

function getPurchasableCatalogVariant(product: ShopProduct): ShopProductVariant | null {
  return product.variants.find((variant) => variant.isDefault && variant.inStock && variant.stock > 0) ??
    product.variants.find((variant) => variant.inStock && variant.stock > 0) ??
    null;
}

function getCatalogDisplayVariant(product: ShopProduct): ShopProductVariant | null {
  return getPurchasableCatalogVariant(product) ??
    product.variants.find((variant) => variant.isDefault) ??
    product.variants[0] ??
    null;
}

function getCatalogVisibleImages(product: ShopProduct) {
  const productLevelImages = product.images.filter((image) => (image.variantIds ?? []).length === 0);
  const defaultVariant = product.variants.find((variant) => variant.isDefault) ?? product.variants[0];
  const defaultVariantImages = defaultVariant
    ? product.images.filter((image) => (image.variantIds ?? []).includes(defaultVariant.id))
    : [];
  return uniqueImagesById(
    productLevelImages.length || defaultVariantImages.length
      ? [...productLevelImages, ...defaultVariantImages]
      : product.images
  );
}

function uniqueImagesById(images: ShopProduct["images"]) {
  const seen = new Set<string>();
  return images.filter((image) => {
    if (seen.has(image.id)) {
      return false;
    }
    seen.add(image.id);
    return true;
  });
}

function filtersEqual(left: ShopProductsFilters, right: ShopProductsFilters) {
  return left.category === right.category &&
    left.limit === right.limit &&
    left.page === right.page &&
    left.q === right.q &&
    left.sort === right.sort;
}

function buildLocalCatalogData(base: ShopProductsResponse, filters: ShopProductsFilters): ShopProductsResponse {
  const q = filters.q.trim();
  const categoryFilter = filters.category;
  const filteredBySearch = q
    ? base.products.filter((product) => matchesSearch(product, q))
    : base.products;
  const filtered = categoryFilter
    ? filteredBySearch.filter((product) => matchesCategory(product, categoryFilter))
    : filteredBySearch;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));
  const page = Math.min(Math.max(filters.page, 1), totalPages);
  const start = (page - 1) * filters.limit;
  const products = filtered.slice(start, start + filters.limit);

  return {
    ...base,
    products,
    facets: buildLocalFacets(base.products, q),
    pagination: {
      page,
      limit: filters.limit,
      total,
      totalPages,
      hasNextPage: page < totalPages
    },
    filters
  };
}

function buildLocalFacets(products: ShopProduct[], q: string) {
  const source = q ? products.filter((product) => matchesSearch(product, q)) : products;
  const categories = new Map<string, { slug: string; name: string; count: number }>();
  const subCategoryBuckets = new Map<string, { total: number; labels: Map<string, number> }>();

  for (const product of source) {
    const categorySlug = product.categorySlug?.trim();
    const categoryName = product.category?.trim();
    if (categorySlug && categoryName) {
      const current = categories.get(categorySlug);
      if (current) {
        current.count += 1;
      } else {
        categories.set(categorySlug, { slug: categorySlug, name: categoryName, count: 1 });
      }
    }

    const subCategory = product.subCategory?.trim();
    if (!subCategory) {
      continue;
    }
    const canonical = subCategory.replace(/\s+/g, " ").toLowerCase();
    const bucket = subCategoryBuckets.get(canonical) ?? { total: 0, labels: new Map<string, number>() };
    bucket.total += 1;
    bucket.labels.set(subCategory, (bucket.labels.get(subCategory) ?? 0) + 1);
    subCategoryBuckets.set(canonical, bucket);
  }

  const subCategories = Array.from(subCategoryBuckets.values())
    .map((bucket) => {
      const labels = Array.from(bucket.labels.entries()).sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }
        return left[0].localeCompare(right[0]);
      });
      return {
        name: labels[0]?.[0] ?? "Other",
        count: bucket.total
      };
    })
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.name.localeCompare(right.name);
    });

  return {
    categories: Array.from(categories.values()).sort((left, right) => left.name.localeCompare(right.name)),
    subCategories
  };
}

function matchesCategory(product: ShopProduct, rawCategory: string) {
  const category = rawCategory.trim();
  if (!category) {
    return true;
  }
  const isSlug = CATEGORY_SLUG_PATTERN.test(category);
  if (isSlug) {
    const slug = category.toLowerCase();
    const deSlugged = slug.replace(/-/g, " ");
    return product.categorySlug?.toLowerCase() === slug ||
      product.subCategory?.toLowerCase() === category.toLowerCase() ||
      product.subCategory?.toLowerCase() === deSlugged;
  }
  return product.subCategory?.toLowerCase() === category.toLowerCase();
}

function matchesSearch(product: ShopProduct, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return [
    product.name,
    product.description ?? "",
    product.subCategory,
    product.productType,
    product.category
  ].some((value) => value.toLowerCase().includes(needle));
}
