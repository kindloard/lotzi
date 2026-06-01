"use client";

import { memo, useMemo } from "react";
import { Apple, Beef, Cake, ChevronRight, Milk, ShoppingBag, type LucideIcon } from "lucide-react";
import type { Shop } from "../shops-api";

const categories: Array<{
  id: string;
  name: string;
  icon: LucideIcon;
  color: string;
}> = [
  {
    id: "all",
    name: "All Shops",
    icon: ShoppingBag,
    color: "from-slate-500/10 to-slate-600/5 text-slate-800 border-slate-200"
  },
  {
    id: "grocery",
    name: "Grocery",
    icon: ShoppingBag,
    color: "from-emerald-500/10 to-emerald-600/5 text-emerald-800 border-emerald-100"
  },
  {
    id: "vegetables",
    name: "Vegetables",
    icon: Apple,
    color: "from-amber-500/10 to-amber-600/5 text-amber-800 border-amber-100"
  },
  {
    id: "bakery",
    name: "Bakery",
    icon: Cake,
    color: "from-rose-500/10 to-rose-600/5 text-rose-800 border-rose-100"
  },
  {
    id: "dairy",
    name: "Dairy & Eggs",
    icon: Milk,
    color: "from-blue-500/10 to-blue-600/5 text-blue-800 border-blue-100"
  },
  {
    id: "meat",
    name: "Meat & Fish",
    icon: Beef,
    color: "from-red-500/10 to-red-600/5 text-red-800 border-red-100"
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
  const counts = useMemo(() => {
    const next: Record<string, number> = { all: shops.length };
    for (const shop of shops) {
      next[shop.type] = (next[shop.type] ?? 0) + 1;
    }
    return next;
  }, [shops]);

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="hidden md:flex flex-col justify-between gap-3 md:flex-row md:items-end md:gap-4">
        <div className="space-y-2">
          <h2 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            Explore by Category
          </h2>
          <p className="hidden text-sm text-slate-500 md:block">
            Find specifically what you need from neighborhood specialty stores
          </p>
        </div>
        <div className="flex items-center gap-1 text-xs font-bold text-emerald-700 transition-all hover:text-emerald-800">
          <span>View All Categories</span>
          <ChevronRight size={14} />
        </div>
      </div>

      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 scrollbar-hide sm:mx-0 sm:px-0 md:pb-3">
        {categories.map((category) => {
          const Icon = category.icon;
          const isSelected = selectedCategory === category.id;
          const count = counts[category.id] ?? 0;

          return (
            <button
              key={category.id}
              type="button"
              onClick={() => onSelectCategory(category.id)}
              className={`flex shrink-0 items-center gap-2.5 rounded-2xl border px-4 py-3 transition-all duration-300 ${
                isSelected
                  ? "border-black bg-black text-white shadow-md"
                  : `bg-gradient-to-r ${category.color} hover:shadow-sm`
              }`}
            >
              <Icon size={15} strokeWidth={2.4} />
              <div>
                <p className="text-xs font-bold leading-none">{category.name}</p>
                <p className={`hidden md:block mt-0.5 text-[9px] leading-none ${isSelected ? "text-slate-300" : "text-slate-500"}`}>
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
