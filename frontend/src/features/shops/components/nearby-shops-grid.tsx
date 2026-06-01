"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { MapPin, ShoppingBag } from "lucide-react";
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
  const { coordinates, requestLocation, status: locationStatus } = usePreciseLocation();
  const distancesQuery = useShopDistances(coordinates);
  const shops = shopsQuery.data ?? initialShops;
  const locationNeedsAction =
    locationStatus === "denied" ||
    locationStatus === "error" ||
    locationStatus === "unsupported";
  const locationSubtitle =
    locationStatus === "loading"
      ? t("subtitleLoading")
      : locationStatus === "denied"
        ? t("subtitleDenied")
        : locationStatus === "error" || locationStatus === "unsupported"
          ? t("subtitleUnavailable")
          : t("subtitleLoaded");
  const locationNoticeTitle =
    locationStatus === "denied"
      ? t("locationDeniedTitle")
      : locationStatus === "unsupported"
        ? t("locationUnsupportedTitle")
        : t("locationErrorTitle");
  const locationNoticeDescription =
    locationStatus === "denied"
      ? t("locationDeniedDescription")
      : locationStatus === "unsupported"
        ? t("locationUnsupportedDescription")
        : t("locationErrorDescription");

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
            {locationSubtitle}
          </p>
        </div>
        {!locationNeedsAction ? (
          <span className="hidden md:inline-flex shrink-0 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-bold text-white shadow-sm">
            {isInitialLoading
              ? t("statusLoading")
              : visibleShops.length === 0
                ? t("statusEmpty")
                : t("statusCount", { count: visibleShops.length })}
          </span>
        ) : null}
      </div>

      {locationNeedsAction ? (
        <div className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white px-4 py-4 text-sm text-slate-950 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-slate-50 text-slate-900">
              <MapPin size={18} aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <p className="font-black">{locationNoticeTitle}</p>
              <p className="text-xs font-semibold leading-5 text-slate-600">
                {locationNoticeDescription}
              </p>
            </div>
          </div>
          {locationStatus !== "unsupported" ? (
            <button
              type="button"
              onClick={() => requestLocation({ ignoreCache: true })}
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-slate-950 px-5 text-xs font-black uppercase tracking-wide text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-950 focus:ring-offset-2 sm:h-10"
            >
              {t("enableLocation")}
            </button>
          ) : null}
        </div>
      ) : null}

      {!locationNeedsAction ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {isInitialLoading ? (
            Array.from({ length: 6 }).map((_, index) => (
              <ShopCardSkeleton key={index} />
            ))
          ) : visibleShops.length === 0 ? (
            <div className="col-span-full space-y-4 rounded-lg border border-slate-200/80 bg-white p-8 py-12 text-center">
              <div className="mx-auto inline-flex size-14 items-center justify-center rounded-lg border border-slate-100 bg-slate-50 text-slate-400 shadow-inner">
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
      ) : null}
    </div>
  );
});
