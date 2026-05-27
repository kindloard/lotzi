import {
  productSortOptions,
  stockFilterOptions,
  updatedFilterOptions,
  type ProductFilters
} from "../../lib/product-filters";
import { FilterInput, FilterSelect } from "./filter-fields";
import { useTranslations } from "next-intl";

export function ProductFiltersPanel({
  categories,
  filters,
  matchingCount,
  onChange,
  onClear,
  surface = "card"
}: {
  categories: string[];
  filters: ProductFilters;
  matchingCount: number;
  onChange: (filters: ProductFilters) => void;
  onClear: () => void;
  surface?: "card" | "embedded";
}) {
  const t = useTranslations("dashboard");
  const updateFilter = <Key extends keyof ProductFilters>(key: Key, value: ProductFilters[Key]) => {
    onChange({ ...filters, [key]: value });
  };

  const surfaceClass =
    surface === "embedded"
      ? "mb-5 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 sm:p-4"
      : "rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm";

  return (
    <section className={surfaceClass}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <FilterSelect
          label={t("filters.category")}
          onChange={(value) => updateFilter("category", value)}
          options={categories.map((category) => ({ label: category === "All" ? t("common.all") : category, value: category }))}
          value={filters.category}
        />

        <FilterSelect
          label={t("filters.stock")}
          onChange={(value) => updateFilter("stock", value as ProductFilters["stock"])}
          options={stockFilterOptions.map((option) => ({ label: t(option.labelKey as never), value: option.value }))}
          value={filters.stock}
        />

        <FilterInput label={t("filters.minPrice")} onChange={(value) => updateFilter("minPrice", value)} placeholder={t("common.any")} value={filters.minPrice} />
        <FilterInput label={t("filters.maxPrice")} onChange={(value) => updateFilter("maxPrice", value)} placeholder={t("common.any")} value={filters.maxPrice} />

        <FilterSelect
          label={t("filters.updated")}
          onChange={(value) => updateFilter("updated", value as ProductFilters["updated"])}
          options={updatedFilterOptions.map((option) => ({ label: t(option.labelKey as never), value: option.value }))}
          value={filters.updated}
        />

        <FilterSelect
          label={t("filters.sortBy")}
          onChange={(value) => updateFilter("sortBy", value as ProductFilters["sortBy"])}
          options={productSortOptions.map((option) => ({ label: t(option.labelKey as never), value: option.value }))}
          value={filters.sortBy}
        />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-100 pt-4">
        <p className="text-[12px] font-normal text-zinc-500">{t("filters.matchingProducts", { count: matchingCount })}</p>
        <button
          className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-[12px] font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:text-zinc-950 focus:outline-none focus:ring-4 focus:ring-zinc-950/5"
          onClick={onClear}
          type="button"
        >
          {t("filters.clear")}
        </button>
      </div>
    </section>
  );
}
