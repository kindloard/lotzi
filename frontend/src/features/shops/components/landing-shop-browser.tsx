"use client";

import { useCallback, useEffect, useState } from "react";
import type { DealProduct, Shop } from "../shops-api";
import { useNearbyShops } from "../hooks/use-nearby-shops";
import { usePreciseLocation } from "../hooks/use-precise-location";
import { CategoryFilter } from "./category-filter";
import { NearbyShopsGrid } from "./nearby-shops-grid";

interface LandingShopBrowserProps {
  initialProducts: DealProduct[];
  initialShops: Shop[];
}

export function LandingShopBrowser({
  initialProducts,
  initialShops
}: LandingShopBrowserProps) {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const { coordinates, requestLocation, status: locationStatus } = usePreciseLocation();
  const nearbyQuery = useNearbyShops(coordinates);
  const shops = coordinates ? nearbyQuery.data?.items ?? [] : [];

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
      <CategoryFilter
        shops={shops}
        selectedCategory={selectedCategory}
        onSelectCategory={handleSelectCategory}
      />
      <NearbyShopsGrid
        isLoading={nearbyQuery.isLoading}
        locationStatus={locationStatus}
        requestLocation={requestLocation}
        selectedCategory={selectedCategory}
        shops={shops}
      />
    </>
  );
}
