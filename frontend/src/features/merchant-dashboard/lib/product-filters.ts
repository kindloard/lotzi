import type { Product, ProductStatus } from "../types/dashboard";

export type StockFilter = "all" | "inStock" | "lowStock" | "outOfStock";
export type UpdatedFilter = "all" | "today" | "7days" | "30days";
export type ProductSort = "updatedDesc" | "nameAsc" | "priceAsc" | "priceDesc" | "stockAsc" | "revenueDesc" | "salesDesc";

export interface ProductFilters {
  category: string;
  maxPrice: string;
  minPrice: string;
  sortBy: ProductSort;
  status: ProductStatus | "All";
  stock: StockFilter;
  updated: UpdatedFilter;
}

export const defaultProductFilters: ProductFilters = {
  category: "All",
  maxPrice: "",
  minPrice: "",
  sortBy: "updatedDesc",
  status: "All",
  stock: "all",
  updated: "all"
};

export const productStatusOptions: Array<{ labelKey: string; value: ProductFilters["status"] }> = [
  { labelKey: "status.all", value: "All" },
  { labelKey: "status.published", value: "Published" },
  { labelKey: "status.draft", value: "Draft" },
  { labelKey: "status.needsReview", value: "Needs review" }
];

export const stockFilterOptions: Array<{ labelKey: string; value: StockFilter }> = [
  { labelKey: "filters.stockOptions.all", value: "all" },
  { labelKey: "filters.stockOptions.inStock", value: "inStock" },
  { labelKey: "filters.stockOptions.lowStock", value: "lowStock" },
  { labelKey: "filters.stockOptions.outOfStock", value: "outOfStock" }
];

export const updatedFilterOptions: Array<{ labelKey: string; value: UpdatedFilter }> = [
  { labelKey: "filters.updatedOptions.all", value: "all" },
  { labelKey: "filters.updatedOptions.today", value: "today" },
  { labelKey: "filters.updatedOptions.7days", value: "7days" },
  { labelKey: "filters.updatedOptions.30days", value: "30days" }
];

export const productSortOptions: Array<{ labelKey: string; value: ProductSort }> = [
  { labelKey: "filters.sortOptions.updatedDesc", value: "updatedDesc" },
  { labelKey: "filters.sortOptions.nameAsc", value: "nameAsc" },
  { labelKey: "filters.sortOptions.priceAsc", value: "priceAsc" },
  { labelKey: "filters.sortOptions.priceDesc", value: "priceDesc" },
  { labelKey: "filters.sortOptions.stockAsc", value: "stockAsc" },
  { labelKey: "filters.sortOptions.revenueDesc", value: "revenueDesc" },
  { labelKey: "filters.sortOptions.salesDesc", value: "salesDesc" }
];

export function getProductCategories(products: Product[]) {
  return ["All", ...Array.from(new Set(products.map((item) => item.category))).sort((a, b) => a.localeCompare(b))];
}

export function getActiveProductFilterCount(filters: ProductFilters) {
  return [
    filters.status !== "All",
    filters.category !== "All",
    filters.stock !== "all",
    filters.updated !== "all",
    filters.minPrice.trim() !== "",
    filters.maxPrice.trim() !== ""
  ].filter(Boolean).length;
}

export function filterProducts(products: Product[], filters: ProductFilters, globalQuery: string) {
  const q = globalQuery.trim().toLowerCase();
  const min = filters.minPrice.trim() === "" ? null : Number(filters.minPrice);
  const max = filters.maxPrice.trim() === "" ? null : Number(filters.maxPrice);
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  return products
    .filter((item) => {
      const statusMatch = filters.status === "All" || item.status === filters.status;
      const queryMatch = !q || [item.name, item.sku, item.category, item.subCategory, item.productType, item.unitDisplay ?? "", item.pricePerBaseUnitDisplay ?? ""].some((value) => value.toLowerCase().includes(q));
      const categoryMatch = filters.category === "All" || item.category === filters.category;
      const stockMatch =
        filters.stock === "all" ||
        (filters.stock === "inStock" && item.stock > item.reorderPoint) ||
        (filters.stock === "lowStock" && item.stock > 0 && item.stock <= item.reorderPoint) ||
        (filters.stock === "outOfStock" && item.stock <= 0);
      const priceMatch =
        (min === null || Number.isNaN(min) || item.price >= min) &&
        (max === null || Number.isNaN(max) || item.price <= max);
      const updatedAt = Date.parse(item.updatedAt);
      const updatedMatch =
        filters.updated === "all" ||
        (filters.updated === "today" && updatedAt >= startOfToday.getTime()) ||
        (filters.updated === "7days" && updatedAt >= now - 7 * 86400000) ||
        (filters.updated === "30days" && updatedAt >= now - 30 * 86400000);

      return statusMatch && queryMatch && categoryMatch && stockMatch && priceMatch && updatedMatch;
    })
    .sort((a, b) => sortProducts(a, b, filters.sortBy));
}

function sortProducts(a: Product, b: Product, sortBy: ProductSort) {
  if (sortBy === "nameAsc") {
    return a.name.localeCompare(b.name);
  }
  if (sortBy === "priceAsc") {
    return a.price - b.price;
  }
  if (sortBy === "priceDesc") {
    return b.price - a.price;
  }
  if (sortBy === "stockAsc") {
    return a.stock - b.stock;
  }
  if (sortBy === "revenueDesc") {
    return b.revenue - a.revenue;
  }
  if (sortBy === "salesDesc") {
    return b.sales - a.sales;
  }
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}
