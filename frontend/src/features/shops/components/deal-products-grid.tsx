"use client";

import Image from "next/image";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Percent, Plus, TrendingUp } from "lucide-react";
import { formatIndianRupees } from "@/lib/currency";
import { useCart } from "@/lib/cart-context";
import { blurDataUrl, optimizedCloudinaryUrl } from "../lib/image-utils";
import { useDealProducts } from "../hooks/use-deal-products";
import type { DealProduct } from "../shops-api";
import { ProductCardSkeleton } from "./shop-card-skeleton";

interface DealProductsGridProps {
  initialProducts: DealProduct[];
}

export const DealProductsGrid = memo(function DealProductsGrid({
  initialProducts
}: DealProductsGridProps) {
  const productsQuery = useDealProducts(initialProducts);
  const products = productsQuery.data ?? initialProducts;
  const [addedProducts, setAddedProducts] = useState<Record<string, boolean>>({});
  const { addToCart } = useCart();

  const handleAddProduct = useCallback(
    (product: DealProduct) => {
      addToCart({
        id: product.id,
        name: product.name,
        price: product.price,
        shop: product.shop,
        shopId: product.shopId,
        imageBg: product.imageBg,
        imageInitials: product.imageInitials,
        imageUrl: product.imageUrl ?? undefined
      });

      setAddedProducts((current) => ({ ...current, [product.id]: true }));
      window.setTimeout(() => {
        setAddedProducts((current) => ({ ...current, [product.id]: false }));
      }, 1200);
    },
    [addToCart]
  );

  const isInitialLoading = productsQuery.isLoading && products.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            <TrendingUp className="text-rose-600" size={24} />
            Hot Deals Nearby
          </h2>
          <p className="text-sm text-slate-500">
            High-quality products on discount from recommended local merchants
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 transition-all hover:text-slate-900">
          <span>View All Deals</span>
          <ChevronRight size={14} />
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {isInitialLoading ? (
          Array.from({ length: 4 }).map((_, index) => <ProductCardSkeleton key={index} />)
        ) : products.length === 0 ? (
          <div className="col-span-full space-y-4 rounded-3xl border border-slate-200/80 bg-white p-8 py-12 text-center">
            <div className="mx-auto inline-flex size-14 items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 text-slate-400 shadow-inner">
              <TrendingUp size={24} />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900">No Hot Deals Found</h3>
              <p className="mx-auto max-w-xs text-xs text-slate-500">
                We could not find any products listed for sale nearby.
              </p>
            </div>
          </div>
        ) : (
          products.map((product, index) => (
            <DealProductCard
              key={product.id}
              added={Boolean(addedProducts[product.id])}
              onAdd={handleAddProduct}
              product={product}
              priority={index < 4}
            />
          ))
        )}
      </div>
    </div>
  );
});

interface DealProductCardProps {
  added: boolean;
  onAdd: (product: DealProduct) => void;
  product: DealProduct;
  priority?: boolean;
}

const DealProductCard = memo(function DealProductCard({
  added,
  onAdd,
  product,
  priority = false
}: DealProductCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [shouldRenderMedia, setShouldRenderMedia] = useState(priority);
  const imageUrl = useMemo(
    () => optimizedCloudinaryUrl(product.imageUrl, { width: priority ? 400 : 320 }),
    [priority, product.imageUrl]
  );

  useEffect(() => {
    if (priority || shouldRenderMedia || !cardRef.current || !("IntersectionObserver" in window)) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldRenderMedia(true);
          observer.disconnect();
        }
      },
      { rootMargin: "500px 0px" }
    );

    observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [priority, shouldRenderMedia]);

  return (
    <div
      ref={cardRef}
      className="relative flex min-h-[265px] flex-col rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm"
      style={{ contentVisibility: "auto", containIntrinsicSize: "265px" }}
    >
      {product.discount ? (
        <span className="absolute left-3.5 top-3.5 z-10 flex items-center gap-0.5 rounded-lg bg-rose-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white shadow-sm">
          <Percent size={8} />
          {product.discount}
        </span>
      ) : null}

      {imageUrl && shouldRenderMedia ? (
        <div className="relative h-36 w-full overflow-hidden rounded-2xl bg-slate-100 shadow-inner">
          <Image
            src={imageUrl}
            alt={product.name}
            fill
            priority={priority}
            sizes="(max-width: 768px) 100vw, 25vw"
            placeholder="blur"
            blurDataURL={blurDataUrl("#f8fafc")}
            className="object-cover"
          />
        </div>
      ) : (
        <div className={`flex h-36 w-full items-center justify-center rounded-2xl text-2xl font-black shadow-inner ${product.imageBg}`}>
          {product.imageInitials}
        </div>
      )}

      <div className="flex flex-1 flex-col justify-between space-y-3.5 pt-3">
        <div className="space-y-1">
          <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">
            {product.shop}
          </span>
          <h4 className="line-clamp-1 text-xs font-bold text-slate-800">{product.name}</h4>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <div className="flex min-w-0 flex-wrap items-baseline gap-1.5">
            <span className="text-sm font-black text-slate-900">
              {formatIndianRupees(product.price)}
            </span>
            {product.originalPrice ? (
              <span className="text-[10px] text-slate-400 line-through">
                {formatIndianRupees(product.originalPrice)}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => onAdd(product)}
            className={`inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg border px-2 transition-all ${
              added
                ? "border-emerald-500 bg-emerald-500 text-white"
                : "border-slate-200 bg-slate-50 text-slate-700 shadow-sm hover:border-slate-900 hover:bg-white hover:text-slate-950"
            }`}
            title="Add to basket"
            aria-label={`Add ${product.name} to basket`}
          >
            {added ? <span className="text-[9px] font-black uppercase">Added</span> : <Plus size={14} strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </div>
  );
});
