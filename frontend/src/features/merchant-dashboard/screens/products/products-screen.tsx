"use client";

import {
  AlertTriangle,
  FileText,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCcw,
  SlidersHorizontal,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/toast/toast-context";
import { useMerchantProductUi } from "../../providers/merchant-product-ui-provider";
import { useMerchantProducts } from "../../providers/merchant-products";
import { useMerchantShellUi } from "../../providers/merchant-shell-ui-provider";
import { useDashboardFormatters } from "../../lib/use-dashboard-formatters";
import { CatalogSectionHeader } from "../../components/catalog/catalog-section-header";
import { ProductFiltersPanel } from "../../components/filters/product-filters-panel";
import {
  defaultProductFilters,
  filterProducts,
  getActiveProductFilterCount,
  getProductCategories,
  productStatusOptions,
  type ProductFilters
} from "../../lib/product-filters";
import {
  DashboardButton,
  EmptyState,
  IconButton,
  PageTitle,
  Panel,
  ProductCard,
  ProductThumb,
  SegmentedControl,
  StatusBadge,
  Toolbar
} from "../../components/ui/dashboard-ui";

export function ProductsScreen() {
  const t = useTranslations("dashboard");
  const toast = useToast();
  const format = useDashboardFormatters();
  const { globalQuery } = useMerchantShellUi();
  const { loadState: productLoadState, products, retryProducts, setProducts } = useMerchantProducts();
  const { duplicateProduct, editProduct, openProductCreate, requestArchiveProduct } = useMerchantProductUi();
  const [layout, setLayout] = useState<"table" | "grid">("table");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<ProductFilters>(defaultProductFilters);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(() => new Set());

  const categories = useMemo(() => getProductCategories(products), [products]);
  const activeFilterCount = useMemo(() => getActiveProductFilterCount(filters), [filters]);
  const filtered = useMemo(() => filterProducts(products, filters, globalQuery), [filters, globalQuery, products]);
  const filteredIds = useMemo(() => filtered.map((item) => item.id), [filtered]);
  const isInitialProductLoad = productLoadState.status === "loading" && products.length === 0;
  const isEmptyProductError = productLoadState.status === "error" && products.length === 0;
  const selectedCount = selectedProductIds.size;
  const allVisibleSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedProductIds.has(id));

  const clearFilters = () => {
    setFilters({ ...defaultProductFilters });
  };

  useEffect(() => {
    setSelectedProductIds((current) => {
      if (current.size === 0) {
        return current;
      }
      const visibleIds = new Set(filteredIds);
      const next = new Set(Array.from(current).filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filteredIds]);

  const clearSelection = () => {
    setSelectedProductIds(new Set());
  };

  const toggleLayout = () => {
    const nextLayout = layout === "table" ? "grid" : "table";
    if (nextLayout === "grid") {
      setSelectionMode(false);
      clearSelection();
    }
    setLayout(nextLayout);
  };

  const toggleSelectionMode = () => {
    if (selectionMode) {
      setSelectionMode(false);
      clearSelection();
      return;
    }
    setSelectionMode(true);
  };

  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        filteredIds.forEach((id) => next.delete(id));
      } else {
        filteredIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const deleteSelectedProducts = () => {
    if (selectedProductIds.size === 0) {
      return;
    }
    const selectedIds = new Set(selectedProductIds);
    setProducts((current) => current.filter((item) => !selectedIds.has(item.id)));
    toast.success(t("toasts.productsDeleted", { count: selectedIds.size }));
    setSelectionMode(false);
    clearSelection();
  };

  return (
    <div className="space-y-6">
      <PageTitle
        actions={
          <>
            <DashboardButton
              icon={layout === "table" ? LayoutDashboard : FileText}
              label={layout === "table" ? t("common.grid") : t("common.table")}
              onClick={toggleLayout}
              variant="secondary"
            />
            <DashboardButton icon={Plus} label={t("products.addProduct")} onClick={openProductCreate} showLabelOnMobile />
          </>
        }
        eyebrow={t("products.eyebrow")}
        title={t("products.title")}
      />

      {isInitialProductLoad && (
        <EmptyState
          icon={LoaderCircle}
          title={t("products.loadingTitle")}
          body={t("products.loadingDescription")}
        />
      )}

      {isEmptyProductError && (
        <EmptyState
          actionIcon={RefreshCcw}
          actionLabel={t("products.retryLoad")}
          body={productLoadState.message ?? t("products.loadFailedDescription")}
          icon={AlertTriangle}
          onAction={retryProducts}
          title={t("products.loadFailedTitle")}
        />
      )}

      {(isInitialProductLoad || isEmptyProductError) ? null : (
        <>

      <Toolbar className="lg:w-fit">
        <div className="flex w-full flex-col gap-3">
          <SegmentedControl
            options={productStatusOptions.map((option) => ({ label: t(option.labelKey as never), value: option.value }))}
            value={filters.status}
            onChange={(value) => setFilters((current) => ({ ...current, status: value as ProductFilters["status"] }))}
          />
        </div>
      </Toolbar>

      {filtered.length === 0 ? (
        <section className="space-y-4">
          <CatalogSectionHeader
            action={
              <DashboardButton
                icon={SlidersHorizontal}
                label={activeFilterCount > 0 ? t("common.filtersWithCount", { count: activeFilterCount }) : t("common.filters")}
                onClick={() => setFiltersOpen((open) => !open)}
                variant="secondary"
              />
            }
            eyebrow={t("products.counts.catalog", { count: filtered.length })}
            title={t("products.catalog")}
          />

          {filtersOpen && (
            <ProductFiltersPanel
              categories={categories}
              filters={filters}
              matchingCount={filtered.length}
              onChange={setFilters}
              onClear={clearFilters}
            />
          )}

          <EmptyState icon={PackagePlus} title={t("products.emptyTitle")} body={t("products.emptyDescription")} actionLabel={t("products.addProduct")} onAction={openProductCreate} />
        </section>
      ) : layout === "grid" ? (
        <section className="space-y-4">
          <CatalogSectionHeader
            action={
              <DashboardButton
                icon={SlidersHorizontal}
                label={activeFilterCount > 0 ? t("common.filtersWithCount", { count: activeFilterCount }) : t("common.filters")}
                onClick={() => setFiltersOpen((open) => !open)}
                variant="secondary"
              />
            }
            eyebrow={t("products.counts.catalog", { count: filtered.length })}
            title={t("products.catalog")}
          />

          {filtersOpen && (
            <ProductFiltersPanel
              categories={categories}
              filters={filters}
              matchingCount={filtered.length}
              onChange={setFilters}
              onClear={clearFilters}
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {filtered.map((item) => (
              <ProductCard
                key={item.id}
                onArchive={() => requestArchiveProduct(item)}
                onDuplicate={() => duplicateProduct(item)}
                onEdit={() => editProduct(item)}
                product={item}
              />
            ))}
          </div>
        </section>
      ) : (
        <Panel
          action={
            <div className="flex flex-wrap justify-end gap-2">
              {selectionMode && (
                <DashboardButton
                  disabled={selectedCount === 0}
                  icon={Trash2}
                  label={selectedCount > 0 ? t("products.deleteSelectedWithCount", { count: selectedCount }) : t("products.deleteSelected")}
                  onClick={deleteSelectedProducts}
                  showLabelOnMobile
                  variant="secondary"
                />
              )}
              <DashboardButton
                label={selectionMode ? t("products.cancelSelection") : t("products.select")}
                onClick={toggleSelectionMode}
                variant="secondary"
              />
              <DashboardButton
                icon={SlidersHorizontal}
                label={activeFilterCount > 0 ? t("common.filtersWithCount", { count: activeFilterCount }) : t("common.filters")}
                onClick={() => setFiltersOpen((open) => !open)}
                variant="secondary"
              />
            </div>
          }
          title={t("products.catalog")}
          eyebrow={t("products.counts.catalog", { count: filtered.length })}
        >
          {filtersOpen && (
            <ProductFiltersPanel
              categories={categories}
              filters={filters}
              matchingCount={filtered.length}
              onChange={setFilters}
              onClear={clearFilters}
              surface="embedded"
            />
          )}

          {selectionMode && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 py-2 text-[12px] font-medium text-zinc-600">
              <span className="text-zinc-700">{t("products.selectedCount", { count: selectedCount })}</span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:text-zinc-950"
                  onClick={toggleVisibleSelection}
                  type="button"
                >
                  {allVisibleSelected ? t("products.clearVisible") : t("products.selectVisible")}
                </button>
                <button
                  className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:text-zinc-950 disabled:pointer-events-none disabled:opacity-50"
                  disabled={selectedCount === 0}
                  onClick={clearSelection}
                  type="button"
                >
                  {t("products.clearSelection")}
                </button>
              </div>
            </div>
          )}

          <div className="scrollbar-hide -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[1200px] border-collapse overflow-hidden rounded-xl border border-zinc-200 text-left lg:min-w-[1320px]">
              <thead className="[&_th]:border [&_th]:border-zinc-200 [&_th]:bg-zinc-50/80 [&_th]:px-3 [&_th]:py-3">
                <tr className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400 sm:text-[11px] sm:tracking-wider">
                  <th className="w-[92px] border-b border-zinc-100 pb-3 pr-4">
                    <div className="flex items-center gap-2">
                      {selectionMode && (
                        <input
                          aria-label={t("products.selectAllVisible")}
                          checked={allVisibleSelected}
                          className="size-4 rounded border-zinc-300 accent-zinc-950"
                          onChange={toggleVisibleSelection}
                          type="checkbox"
                        />
                      )}
                      <span>{t("products.columns.serial")}</span>
                    </div>
                  </th>
                  <th className="w-[260px] border-b border-zinc-100 pb-3 pr-4">{t("products.columns.product")}</th>
                  <th className="w-[140px] border-b border-zinc-100 pb-3 pr-4">{t("products.columns.category")}</th>
                  <th className="w-[160px] border-b border-zinc-100 pb-3 pr-4">{t("products.columns.subCategory")}</th>
                  <th className="w-[150px] border-b border-zinc-100 pb-3 pr-4">{t("products.columns.productType")}</th>
                  <th className="w-[130px] border-b border-zinc-100 pb-3 pr-4">{t("products.columns.status")}</th>
                  <th className="w-[96px] border-b border-zinc-100 pb-3 pr-4 text-right">{t("products.columns.price")}</th>
                  <th className="w-[88px] border-b border-zinc-100 pb-3 pr-4 text-right">{t("products.columns.stock")}</th>
                  <th className="w-[116px] border-b border-zinc-100 pb-3 pr-4 text-right">{t("products.columns.revenue")}</th>
                  <th className="w-[104px] border-b border-zinc-100 pb-3 pr-4">{t("products.columns.updated")}</th>
                  <th className="w-[132px] border-b border-zinc-100 pb-3 text-right">{t("products.columns.actions")}</th>
                </tr>
              </thead>
              <tbody className="[&_td]:border [&_td]:border-zinc-100 [&_td]:px-3">
                {filtered.map((item, index) => (
                  <tr key={item.id} className="group transition-colors hover:bg-zinc-50/50">
                    <td className="py-3.5 pr-4">
                      <div className="flex items-center gap-2 text-[13px] font-semibold tabular-nums text-zinc-500">
                        {selectionMode && (
                          <input
                            aria-label={t("products.selectProduct", { name: item.name })}
                            checked={selectedProductIds.has(item.id)}
                            className="size-4 rounded border-zinc-300 accent-zinc-950"
                            onChange={() => toggleProductSelection(item.id)}
                            type="checkbox"
                          />
                        )}
                        <span>{index + 1}</span>
                      </div>
                    </td>
                    <td className="py-3.5 pr-4">
                      <div className="flex items-center gap-3">
                        <ProductThumb product={item} />
                        <div className="min-w-0">
                          <p className="max-w-[170px] truncate text-[13px] font-semibold text-zinc-950 sm:max-w-[220px]">
                            {item.unitDisplay ? `${item.name} - ${item.unitDisplay}` : item.name}
                          </p>
                          <p className="mt-0.5 max-w-[170px] truncate font-mono text-[11px] font-normal tracking-normal text-zinc-500 sm:max-w-[220px]">
                            {item.sku || item.pricePerBaseUnitDisplay || "-"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 pr-4 text-[13px] font-medium text-zinc-700"><span className="block max-w-[130px] truncate">{item.category || "-"}</span></td>
                    <td className="py-3.5 pr-4 text-[13px] font-normal text-zinc-600"><span className="block max-w-[150px] truncate">{item.subCategory || "-"}</span></td>
                    <td className="py-3.5 pr-4 text-[13px] font-normal text-zinc-600"><span className="block max-w-[140px] truncate">{item.productType || "-"}</span></td>
                    <td className="py-3.5 pr-4"><StatusBadge label={item.status} /></td>
                    <td className="py-3.5 pr-4 text-right text-[13px] font-medium tabular-nums text-zinc-900">
                      <span className="block">{format.currency(item.price)}</span>
                      {item.pricePerBaseUnitDisplay && <span className="block text-[10px] font-normal text-zinc-400">{item.pricePerBaseUnitDisplay}</span>}
                    </td>
                    <td className="py-3.5 pr-4 text-right text-[13px] font-medium tabular-nums text-zinc-900">{format.number(item.stock)}</td>
                    <td className="py-3.5 pr-4 text-right text-[13px] font-medium tabular-nums text-zinc-900">{format.currency(item.revenue)}</td>
                    <td className="whitespace-nowrap py-3.5 pr-4 text-[13px] font-normal text-zinc-500">{format.relativeDate(item.updatedAt)}</td>
                    <td className="py-3.5">
                      <div className="flex justify-end gap-1.5">
                        <IconButton label={t("products.duplicate")} onClick={() => duplicateProduct(item)}>
                          <Layers3 size={14} />
                        </IconButton>
                        <IconButton label={t("products.edit")} onClick={() => editProduct(item)}>
                          <Pencil size={14} />
                        </IconButton>
                        <IconButton label={t("products.archive")} onClick={() => requestArchiveProduct(item)}>
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
        </>
      )}
    </div>
  );
}

