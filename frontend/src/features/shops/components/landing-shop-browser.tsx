"use client";

import { useCallback, useEffect, useState } from "react";
import type { DealProduct, Shop } from "../shops-api";
import { useShops } from "../hooks/use-shops";
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
  const shopsQuery = useShops(initialShops);
  const shops = shopsQuery.data ?? initialShops;

  useEffect(() => {
    const handler = (event: Event) => {
      const category = (event as CustomEvent<{ category?: string }>).detail?.category;
      if (category) {
        setSelectedCategory(category);
      }
    };

    window.addEventListener("namastore:select-category", handler);
    return () => window.removeEventListener("namastore:select-category", handler);
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
      <NearbyShopsGrid initialShops={initialShops} selectedCategory={selectedCategory} />
    </>
  );
}
