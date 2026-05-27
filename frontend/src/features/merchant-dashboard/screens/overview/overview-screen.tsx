"use client";

import { Activity, Banknote, Boxes, Clock3, Download, LayoutDashboard, Package, ReceiptText } from "lucide-react";
import { useTranslations } from "next-intl";
import { revenueTrend } from "../../data/chart-data";
import { useMerchantAnalytics } from "../../providers/merchant-analytics";
import { useMerchantNavigation } from "../../providers/merchant-navigation";
import { useDashboardFormatters } from "../../lib/use-dashboard-formatters";
import { LineChart } from "../../components/charts/dashboard-charts";
import {
  DashboardButton,
  Insight,
  KpiCard,
  PageTitle,
  Panel,
  PanelAction,
  ProductThumb,
  StatusBadge
} from "../../components/ui/dashboard-ui";

export function OverviewScreen() {
  const t = useTranslations("dashboard");
  const format = useDashboardFormatters();
  const { bestProducts, metrics } = useMerchantAnalytics();
  const { navigate } = useMerchantNavigation();
  return (
    <div className="space-y-6 sm:space-y-8 lg:space-y-10">
      <PageTitle
        actions={
          <>
            <DashboardButton icon={Clock3} label={t("common.last30Days")} variant="secondary" />
            <DashboardButton icon={LayoutDashboard} label={t("common.addWidget")} variant="secondary" />
            <DashboardButton icon={Download} label={t("common.export")} />
          </>
        }
        eyebrow={t("overview.eyebrow")}
        title={t("overview.title")}
      />

      <section className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiCard label={t("overview.totalRevenue")} value={format.currency(metrics.revenue)} delta="+12.8%" icon={Banknote} tone="positive" />
        <KpiCard label={t("overview.orders")} value={format.number(metrics.orderCount)} delta="+8.1%" icon={ReceiptText} tone="positive" />
        <KpiCard label={t("overview.products")} value={format.number(metrics.productCount)} delta={`+${format.number(3)} ${t("common.live")}`} icon={Package} tone="positive" />
        <KpiCard label={t("overview.pendingOrders")} value={format.number(metrics.pendingOrders)} delta={t("status.actionRequired")} icon={Clock3} tone="urgent" />
        <KpiCard label={t("overview.inventoryAlerts")} value={format.number(metrics.inventoryAlerts)} delta={t("status.belowThreshold")} icon={Boxes} tone="urgent" />
        <KpiCard label={t("common.conversion")} value={format.percent(metrics.conversion)} delta="+0.7%" icon={Activity} tone="positive" />
      </section>

      <section>
        <Panel
          action={<PanelAction onClick={() => navigate("analytics")} label={t("common.openAnalytics")} />}
          eyebrow={t("overview.revenueIntelligence")}
          title={t("overview.salesPerformance")}
        >
          <LineChart ariaLabel={t("analytics.revenueTrend")} data={revenueTrend} height={250} />
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Insight label={t("overview.netSales")} value={format.currency(284900)} detail={t("common.bestHour", { timeRange: "6 PM to 8 PM" })} />
            <Insight label={t("overview.averageOrderValue")} value={format.currency(846)} detail={t("common.upThisWeek", { value: "9.4%" })} />
            <Insight label={t("overview.traffic")} value="50.1k" detail={t("common.mobileShare", { value: "74%" })} />
          </div>
        </Panel>
      </section>

      <section className="grid gap-6">
        <Panel
          action={<PanelAction onClick={() => navigate("products")} label={t("common.viewProducts")} />}
          eyebrow={t("overview.catalog")}
          title={t("overview.bestSellingProducts")}
        >
          <div className="space-y-2 md:hidden">
            {bestProducts.map((item) => (
              <button
                className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50/40 p-3 text-left transition hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-zinc-950/5"
                key={item.id}
                onClick={() => navigate("products")}
                type="button"
              >
                <ProductThumb product={item} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-zinc-950">{item.name}</span>
                  <span className="mt-0.5 block truncate text-[11px] font-normal tracking-normal text-zinc-500">{item.sku || item.productType || item.subCategory || item.category}</span>
                </span>
                <span className="text-right">
                  <span className="block text-[12px] font-semibold tabular-nums text-zinc-950">{item.sales}</span>
                  <span className="block text-[10px] font-medium uppercase tracking-[0.08em] text-zinc-400">{t("common.sales")}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[620px] border-separate border-spacing-0 text-left">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  <th className="pb-3 border-b border-zinc-100">{t("common.product")}</th>
                  <th className="pb-3 text-right border-b border-zinc-100">{t("common.sales")}</th>
                  <th className="pb-3 text-right border-b border-zinc-100">{t("common.revenue")}</th>
                  <th className="pb-3 text-right border-b border-zinc-100">{t("common.conversion")}</th>
                  <th className="pb-3 text-right border-b border-zinc-100">{t("common.stock")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {bestProducts.map((item) => (
                  <tr key={item.id} className="hover:bg-zinc-50/50 transition-colors">
                    <td className="py-3.5 pr-4">
                      <div className="flex items-center gap-3">
                        <ProductThumb product={item} />
                        <div>
                          <p className="text-[13px] font-semibold text-zinc-950">{item.name}</p>
                          <p className="text-[11px] font-normal text-zinc-500 font-mono tracking-normal">{item.sku || item.productType || item.subCategory || item.category}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 text-[13px] font-medium text-zinc-900 text-right tabular-nums">{format.number(item.sales)}</td>
                    <td className="py-3.5 text-[13px] font-medium text-zinc-900 text-right tabular-nums">{format.currency(item.revenue)}</td>
                    <td className="py-3.5 text-[13px] font-medium text-zinc-900 text-right tabular-nums">{format.percent(item.conversion)}</td>
                    <td className="py-3.5 text-right"><StatusBadge label={t("overview.stockLeft", { count: item.stock })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>
    </div>
  );
}

