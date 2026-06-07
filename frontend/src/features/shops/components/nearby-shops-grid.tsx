"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { MapPin, ShoppingBag, Cloud } from "lucide-react";
import type { Shop } from "../shops-api";
import type { LocationStatus } from "../hooks/use-precise-location";
import { ShopCard } from "./shop-card";
import { ShopCardSkeleton } from "./shop-card-skeleton";
import { useTranslations } from "next-intl";

export type NearbyShopsDisplayState = "locationRequired" | "expandingRadius" | "nearbyResolved" | "trueEmpty";

interface NearbyShopsGridProps {
  displayState: NearbyShopsDisplayState;
  effectiveRadiusKm: number;
  isLoading: boolean;
  locationStatus: LocationStatus;
  requestLocation: (options?: { ignoreCache?: boolean }) => void;
  selectedCategory: string;
  shops: Shop[];
}

export const NearbyShopsGrid = memo(function NearbyShopsGrid({
  displayState,
  effectiveRadiusKm,
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
    locationStatus === "loading" || displayState === "expandingRadius"
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

  const shouldRenderShopResults = !locationNeedsAction;
  const isInitialLoading =
    shouldRenderShopResults &&
    shops.length === 0 &&
    isLoading;
  const shopsGridClassName =
    visibleShops.length === 1 && !isInitialLoading
      ? "grid w-full max-w-[440px] gap-4"
      : "grid gap-4 sm:grid-cols-2 xl:grid-cols-3";

  return (
    <div id="shops-section" className="space-y-6">
      {!(shouldRenderShopResults && visibleShops.length === 0 && !isInitialLoading) ? (
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
              {isInitialLoading || displayState === "expandingRadius"
                ? t("statusLoading")
                : visibleShops.length === 0
                  ? t("statusEmpty")
                  : t("statusCount", { count: visibleShops.length })}
            </span>
          ) : null}
        </div>
      ) : null}

      {locationNeedsAction ? (
        <>
          {/* Mobile Full-Screen Location View */}
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center md:hidden min-h-[50vh]">
            <div className="relative mb-10 mt-4">
              <div className="relative z-10 flex items-center justify-center">
                <MapPin size={64} className="text-slate-900" strokeWidth={1.5} />
              </div>
              <Cloud className="absolute -left-12 -top-4 z-0 text-slate-200" size={56} strokeWidth={2} />
              <Cloud className="absolute -right-10 top-2 z-0 text-slate-200" size={48} strokeWidth={2} />
              <Cloud className="absolute -left-4 -bottom-6 z-0 text-slate-100" size={40} strokeWidth={2} />
            </div>
            
            <h2 className="mb-3 text-2xl font-black tracking-tight text-slate-950">
              {locationNoticeTitle}
            </h2>
            <p className="mb-8 max-w-[280px] text-sm font-medium leading-relaxed text-slate-500">
              {locationNoticeDescription}
            </p>
            
            {locationStatus !== "unsupported" ? (
              <div className="flex w-full flex-col gap-2 px-2">
                <button
                  type="button"
                  disabled={locationStatus === "loading"}
                  onClick={() => requestLocation({ ignoreCache: true })}
                  className="inline-flex h-11 w-full items-center justify-center rounded-full bg-brand px-8 text-[15px] font-black tracking-wide text-slate-900 transition-transform active:scale-[0.98] disabled:opacity-50 shadow-[0_8px_20px_rgba(158,240,26,0.25)]"
                >
                  {locationStatus === "loading"
                    ? t("locationLoadingAction")
                    : locationStatus === "denied"
                      ? t("locationRetryAction")
                      : t("locationAllowAction")}
                </button>
                <button
                  type="button"
                  className="inline-flex h-11 w-full items-center justify-center rounded-full px-8 text-[15px] font-bold text-slate-400 transition-colors active:bg-slate-50"
                  onClick={() => {
                    // Visual only, or scrolls to search
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  {t("locationNotNowAction")}
                </button>
              </div>
            ) : null}
          </div>

          {/* Desktop Compact View */}
          <div className="hidden md:flex flex-col gap-5 rounded-2xl border border-slate-100 bg-white p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/20">
                <MapPin size={20} aria-hidden="true" className="text-slate-900" />
              </div>
              <div className="space-y-1.5 pt-0.5">
                <p className="text-base font-black tracking-tight text-slate-950">{locationNoticeTitle}</p>
                <p className="text-sm font-medium leading-relaxed text-slate-500">
                  {locationNoticeDescription}
                </p>
              </div>
            </div>
            {locationStatus !== "unsupported" ? (
              <button
                type="button"
                disabled={locationStatus === "loading"}
                onClick={() => requestLocation({ ignoreCache: true })}
                className="inline-flex h-12 w-full shrink-0 items-center justify-center rounded-xl bg-brand px-6 text-sm font-bold uppercase tracking-wide text-slate-900 transition-transform active:scale-[0.98] disabled:opacity-50 sm:h-11 sm:w-auto"
              >
                {locationStatus === "loading"
                  ? t("locationLoadingAction")
                  : locationStatus === "denied"
                    ? t("locationRetryAction")
                    : t("enableLocation")}
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {shouldRenderShopResults ? (
        <div
          className={shopsGridClassName}
          data-display-state={displayState}
          data-search-radius-km={effectiveRadiusKm}
        >
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
