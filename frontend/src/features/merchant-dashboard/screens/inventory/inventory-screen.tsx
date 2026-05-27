"use client";

import { BadgeCheck, Bell, Boxes, Package, RefreshCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Product } from "../../types/dashboard";
import { useMerchantAnalytics } from "../../providers/merchant-analytics";
import { useMerchantProductUi } from "../../providers/merchant-product-ui-provider";
import { useDashboardFormatters } from "../../lib/use-dashboard-formatters";
import { DashboardButton, EmptyState, KpiCard, PageTitle, Panel } from "../../components/ui/dashboard-ui";

export function InventoryScreen() {
  const t = useTranslations("dashboard");
  const format = useDashboardFormatters();
  const { lowStockProducts, products } = useMerchantAnalytics();
  const { restockProduct } = useMerchantProductUi();

  return (
    <div className="space-y-6">
      <PageTitle eyebrow={t("inventory.eyebrow")} title={t("inventory.title")} />
      <section className="grid gap-5 lg:grid-cols-3">
        <KpiCard label={t("inventory.unitsOnHand")} value={format.number(products.reduce((total, item) => total + item.stock, 0))} delta={t("status.allLocations")} icon={Boxes} />
        <KpiCard label={t("inventory.lowStock")} value={format.number(lowStockProducts.length)} delta={t("status.belowReorderPoint")} icon={Bell} tone="urgent" />
        <KpiCard label={t("inventory.draftInventory")} value={format.number(products.filter((item) => item.status === "Draft").length)} delta={t("status.notLiveYet")} icon={Package} />
      </section>
      <Panel eyebrow={t("inventory.alerts")} title={t("inventory.lowStockQueue")}>
        <div className="divide-y divide-zinc-100">
          {lowStockProducts.length ? lowStockProducts.map((item) => (
            <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center" key={item.id}>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-zinc-950">
                  {item.unitDisplay ? `${item.name} - ${item.unitDisplay}` : item.name}
                </p>
                <p className="text-[11px] font-normal text-zinc-500">
                  {t("inventory.leftReorderAt", {
                    stock: inventoryStockLabel(item, format.number),
                    reorderPoint: format.number(item.reorderPoint)
                  })}
                </p>
              </div>
              <DashboardButton icon={RefreshCcw} label={t("inventory.restock")} onClick={() => restockProduct(item.id)} variant="secondary" />
            </div>
          )) : (
            <EmptyState icon={BadgeCheck} title={t("inventory.healthyTitle")} body={t("inventory.healthyBody")} />
          )}
        </div>
      </Panel>
    </div>
  );
}

function inventoryStockLabel(product: Product, formatNumber: (value: number) => string) {
  const measurement = product.variants?.[0]?.measurement ?? product.measurement;
  const unitDisplay = product.variants?.[0]?.unitDisplay ?? product.unitDisplay;
  if (!measurement?.normalizedValue || !measurement.normalizedUnit) {
    return formatNumber(product.stock);
  }
  const aggregate = product.stock * measurement.normalizedValue;
  const aggregateDisplay = formatAggregate(aggregate, measurement.normalizedUnit);
  return unitDisplay ? `${formatNumber(product.stock)} x ${unitDisplay} (${aggregateDisplay})` : `${formatNumber(product.stock)} (${aggregateDisplay})`;
}

function formatAggregate(value: number, unit: string) {
  if (unit === "G" && value >= 1000) {
    return `${formatCompact(value / 1000)}kg`;
  }
  if (unit === "ML" && value >= 1000) {
    return `${formatCompact(value / 1000)}L`;
  }
  if (unit === "PIECE") {
    return `${formatCompact(value)} pcs`;
  }
  return `${formatCompact(value)} ${unit.toLowerCase()}`;
}

function formatCompact(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

