"use client";

import { useCallback, useEffect, useState } from "react";
import { useNearbyShops } from "../hooks/use-nearby-shops";
import { usePreciseLocation } from "../hooks/use-precise-location";
import type { InitialNearbyPayload } from "../lib/geo-cookie";
import { CategoryFilter } from "./category-filter";
import { NearbyShopsGrid, type NearbyShopsDisplayState } from "./nearby-shops-grid";

interface LandingShopBrowserProps {
  initialNearby?: InitialNearbyPayload | null;
}

export function LandingShopBrowser({ initialNearby = null }: LandingShopBrowserProps) {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const { coordinates, requestLocation, status: locationStatus } = usePreciseLocation(initialNearby?.coordinates ?? null);
  const nearbyQuery = useNearbyShops(coordinates, null, {
    initialData: initialNearby?.data ?? null,
    initialDataUpdatedAt: initialNearby?.fetchedAt,
    initialRadiusKm: initialNearby?.radiusKm
  });
  const nearbyShops = nearbyQuery.data?.items ?? [];
  const hasNearbyShops = nearbyShops.length > 0;
  const shops = coordinates ? nearbyShops : [];
  const displayState: NearbyShopsDisplayState =
    coordinates && hasNearbyShops
      ? "nearbyResolved"
      : nearbyQuery.isExpandingRadius
        ? "expandingRadius"
        : !coordinates
          ? "locationRequired"
          : nearbyQuery.exhaustedRadiusSearch
            ? "trueEmpty"
            : "nearbyResolved";

  useEffect(() => {
    const handler = (event: Event) => {
      const category = (event as CustomEvent<{ category?: string }>).detail?.category;
      if (category) {
        setSelectedCategory(category);
      }
    };

    window.addEventListener("lotzi:select-category", handler);
    return () => window.removeEventListener("lotzi:select-category", handler);
  }, []);

  const handleSelectCategory = useCallback((category: string) => {
    setSelectedCategory(category);
  }, []);

  return (
    <>
      {displayState !== "locationRequired" && (
        <CategoryFilter
          shops={shops}
          selectedCategory={selectedCategory}
          onSelectCategory={handleSelectCategory}
        />
      )}
      <NearbyShopsGrid
        displayState={displayState}
        effectiveRadiusKm={nearbyQuery.effectiveRadiusKm}
        isLoading={nearbyQuery.isLoading}
        locationStatus={locationStatus}
        requestLocation={requestLocation}
        selectedCategory={selectedCategory}
        shops={shops}
      />
    </>
  );
}
