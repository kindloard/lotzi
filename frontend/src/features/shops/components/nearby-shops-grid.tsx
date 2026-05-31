"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { ShoppingBag } from "lucide-react";
import {
  enrichShopsWithDistance,
  mergeShopDistances,
  type Shop,
} from "../shops-api";
import { usePreciseLocation } from "../hooks/use-precise-location";
import { useShopDistances } from "../hooks/use-shop-distances";
import { useShops } from "../hooks/use-shops";
import { ShopCard } from "./shop-card";
import { ShopCardSkeleton } from "./shop-card-skeleton";
import { useTranslations } from "next-intl";

interface NearbyShopsGridProps {
  initialShops: Shop[];
  selectedCategory: string;
}

export const NearbyShopsGrid = memo(function NearbyShopsGrid({
  initialShops,
  selectedCategory,
}: NearbyShopsGridProps) {
  const t = useTranslations("marketplace.nearbyShops");
  const shopsQuery = useShops(initialShops);
  const [favorites, setFavorites] = useState<string[]>([]);
  const { coordinates, status: locationStatus } = usePreciseLocation();
  const distancesQuery = useShopDistances(coordinates);
  const shops = shopsQuery.data ?? initialShops;

  const visibleShops = useMemo(() => {
    const enriched = mergeShopDistances(
      enrichShopsWithDistance(shops, coordinates),
      distancesQuery.data,
    );
    const filtered =
      selectedCategory === "all"
        ? enriched
        : enriched.filter((shop) => shop.type === selectedCategory);

    if (!coordinates) {
      return filtered;
    }

    return [...filtered].sort(
      (left, right) =>
        (left.distanceMeters ?? Infinity) - (right.distanceMeters ?? Infinity),
    );
  }, [coordinates, distancesQuery.data, selectedCategory, shops]);

  const toggleFavorite = useCallback((shopId: string) => {
    setFavorites((current) =>
      current.includes(shopId)
        ? current.filter((id) => id !== shopId)
        : [...current, shopId],
    );
  }, []);

  const isInitialLoading = shopsQuery.isLoading && shops.length === 0;

  return (
    <div id="shops-section" className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            {t("title")}
          </h2>
          <p className="hidden md:block text-sm text-slate-500">
            {locationStatus === "loading"
              ? t("subtitleLoading")
              : t("subtitleLoaded")}
          </p>
        </div>
        <span className="hidden md:inline-flex shrink-0 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-bold text-white shadow-sm">
          {isInitialLoading
            ? t("statusLoading")
            : visibleShops.length === 0
              ? t("statusEmpty")
              : t("statusCount", { count: visibleShops.length })}
        </span>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {isInitialLoading ? (
          Array.from({ length: 6 }).map((_, index) => (
            <ShopCardSkeleton key={index} />
          ))
        ) : visibleShops.length === 0 ? (
          <div className="col-span-full space-y-4 rounded-3xl border border-slate-200/80 bg-white p-8 py-12 text-center">
            <div className="mx-auto inline-flex size-14 items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 text-slate-400 shadow-inner">
              <ShoppingBag size={24} />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-900">
                {t("noShopsTitle")}
              </h3>
              <p className="mx-auto max-w-xs text-xs text-slate-500">
                {t("noShopsDescription")}
              </p>
            </div>
          </div>
        ) : (
          visibleShops.map((shop, index) => (
            <ShopCard
              key={shop.id}
              shop={shop}
              isFavorite={favorites.includes(shop.id)}
              onToggleFavorite={toggleFavorite}
              priority={index < 3}
            />
          ))
        )}
      </div>
    </div>
  );
});
