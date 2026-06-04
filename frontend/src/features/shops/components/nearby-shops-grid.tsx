"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { MapPin, ShoppingBag } from "lucide-react";
import type { Shop } from "../shops-api";
import type { LocationStatus } from "../hooks/use-precise-location";
import { ShopCard } from "./shop-card";
import { ShopCardSkeleton } from "./shop-card-skeleton";
import { useTranslations } from "next-intl";

interface NearbyShopsGridProps {
  isLoading: boolean;
  locationStatus: LocationStatus;
  requestLocation: (options?: { ignoreCache?: boolean }) => void;
  selectedCategory: string;
  shops: Shop[];
}

export const NearbyShopsGrid = memo(function NearbyShopsGrid({
  isLoading,
  locationStatus,
  requestLocation,
  selectedCategory,
  shops,
}: NearbyShopsGridProps) {
  const t = useTranslations("marketplace.nearbyShops");
  const [favorites, setFavorites] = useState<string[]>([]);
  const locationNeedsAction =
    locationStatus === "idle" ||
    locationStatus === "loading" ||
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
    locationStatus === "loading"
      ? t("locationLoadingTitle")
      : locationStatus === "idle" || locationStatus === "denied"
      ? t("locationDeniedTitle")
      : locationStatus === "unsupported"
        ? t("locationUnsupportedTitle")
        : t("locationErrorTitle");
  const locationNoticeDescription =
    locationStatus === "loading"
      ? t("locationLoadingDescription")
      : locationStatus === "denied"
      ? t("locationBlockedDescription")
      : locationStatus === "idle"
      ? t("locationPromptDescription")
      : locationStatus === "unsupported"
        ? t("locationUnsupportedDescription")
        : t("locationErrorDescription");

  const visibleShops = useMemo(() => {
    return (
      selectedCategory === "all"
        ? shops
        : shops.filter((shop) => shop.type === selectedCategory)
    );
  }, [selectedCategory, shops]);

  const toggleFavorite = useCallback((shopId: string) => {
    setFavorites((current) =>
      current.includes(shopId)
        ? current.filter((id) => id !== shopId)
        : [...current, shopId],
    );
  }, []);

  const isInitialLoading =
    locationStatus === "loading" ||
    (isLoading && visibleShops.length === 0);
  const shopsGridClassName =
    visibleShops.length === 1 && !isInitialLoading
      ? "grid w-full max-w-[440px] gap-4"
      : "grid gap-4 sm:grid-cols-2 xl:grid-cols-3";

  return (
    <div id="shops-section" className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-black sm:text-3xl">
            {t("title")}
          </h2>
          <p className="hidden text-sm font-medium text-slate-500 md:block">
            {locationSubtitle}
          </p>
        </div>
        {!locationNeedsAction ? (
          <span className="hidden shrink-0 rounded-lg bg-black px-3 py-1.5 text-xs font-bold text-white md:inline-flex">
            {isInitialLoading
              ? t("statusLoading")
              : visibleShops.length === 0
                ? t("statusEmpty")
                : t("statusCount", { count: visibleShops.length })}
          </span>
        ) : null}
      </div>

      {locationNeedsAction ? (
        <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white px-4 py-4 text-sm text-black shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-neutral-100 bg-neutral-50 text-black">
              <MapPin size={18} aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <p className="font-bold">{locationNoticeTitle}</p>
              <p className="text-xs font-semibold leading-5 text-slate-600">
                {locationNoticeDescription}
              </p>
            </div>
          </div>
          {locationStatus !== "unsupported" ? (
            <button
              type="button"
              disabled={locationStatus === "loading"}
              onClick={() => requestLocation({ ignoreCache: true })}
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-black px-5 text-xs font-bold uppercase text-white focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2 sm:h-10"
            >
              {locationStatus === "loading"
                ? t("locationLoadingAction")
                : locationStatus === "denied"
                  ? t("locationRetryAction")
                  : t("enableLocation")}
            </button>
          ) : null}
        </div>
      ) : null}

      {!locationNeedsAction ? (
        <div className={shopsGridClassName}>
          {isInitialLoading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <ShopCardSkeleton key={index} />
            ))
          ) : visibleShops.length === 0 ? (
            <div className="col-span-full space-y-4 rounded-lg border border-slate-200/80 bg-white p-8 py-12 text-center">
              <div className="mx-auto inline-flex size-14 items-center justify-center rounded-lg border border-slate-100 bg-slate-50 text-slate-400 shadow-inner">
                <ShoppingBag size={24} />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-black">
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
