"use client";

import { memo, useMemo } from "react";
import { Apple, Beef, Cake, ChevronRight, Milk, ShoppingBag, type LucideIcon } from "lucide-react";
import type { Shop } from "../shops-api";

const categories: Array<{
  id: string;
  name: string;
  icon: LucideIcon;
}> = [
  {
    id: "all",
    name: "All Shops",
    icon: ShoppingBag
  },
  {
    id: "grocery",
    name: "Grocery",
    icon: ShoppingBag
  },
  {
    id: "vegetables",
    name: "Vegetables",
    icon: Apple
  },
  {
    id: "bakery",
    name: "Bakery",
    icon: Cake
  },
  {
    id: "dairy",
    name: "Dairy & Eggs",
    icon: Milk
  },
  {
    id: "meat",
    name: "Meat & Fish",
    icon: Beef
  }
];

interface CategoryFilterProps {
  shops: Shop[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
}

export const CategoryFilter = memo(function CategoryFilter({
  shops,
  selectedCategory,
  onSelectCategory
}: CategoryFilterProps) {
  const { counts, dynamicCategories } = useMemo(() => {
    const nextCounts: Record<string, number> = { all: shops.length };
    const dynamicCatsMap = new Map<string, { id: string; name: string; icon: LucideIcon }>();

    for (const shop of shops) {
      nextCounts[shop.type] = (nextCounts[shop.type] ?? 0) + 1;
      
      if (!dynamicCatsMap.has(shop.type)) {
        const hardcoded = categories.find((c) => c.id === shop.type);
        if (hardcoded) {
          dynamicCatsMap.set(shop.type, hardcoded);
        } else {
          dynamicCatsMap.set(shop.type, {
            id: shop.type,
            name: shop.typeName || shop.type,
            icon: ShoppingBag
          });
        }
      }
    }

    const allCategory = categories[0];
    const otherCategories = Array.from(dynamicCatsMap.values()).sort((a, b) => {
      const aIndex = categories.findIndex((c) => c.id === a.id);
      const bIndex = categories.findIndex((c) => c.id === b.id);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return (nextCounts[b.id] ?? 0) - (nextCounts[a.id] ?? 0);
    });

    return {
      counts: nextCounts,
      dynamicCategories: [allCategory, ...otherCategories]
    };
  }, [shops]);

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="hidden md:flex flex-col justify-between gap-3 md:flex-row md:items-end md:gap-4">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-black sm:text-3xl">
            Explore by Category
          </h2>
          <p className="hidden text-sm font-medium text-slate-500 md:block">
            Find specifically what you need from neighborhood specialty stores
          </p>
        </div>
        <div className="flex items-center gap-1 text-xs font-bold text-black">
          <span>View All Categories</span>
          <ChevronRight size={14} />
        </div>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide sm:mx-0 sm:px-0 md:pb-3">
        {dynamicCategories.map((category) => {
          const Icon = category.icon;
          const isSelected = selectedCategory === category.id;
          const count = counts[category.id] ?? 0;

          return (
            <button
              key={category.id}
              type="button"
              onClick={() => onSelectCategory(category.id)}
              className={`flex h-11 shrink-0 items-center gap-2 rounded-2xl border px-3.5 ${
                isSelected
                  ? "border-brand bg-brand text-black"
                  : "border-neutral-200 bg-white text-black"
              }`}
            >
              <Icon size={15} strokeWidth={2.4} />
              <div>
                <p className="text-xs font-bold leading-none">{category.name}</p>
                <p className={`hidden md:block mt-0.5 text-[9px] leading-none ${isSelected ? "text-black/60" : "text-black/45"}`}>
                  {count} store{count === 1 ? "" : "s"}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});
