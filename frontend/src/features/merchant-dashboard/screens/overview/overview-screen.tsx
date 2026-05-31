"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, ArrowRight, Banknote, Boxes, ChevronDown, Clock3, Package, ReceiptText, ShoppingCart, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMerchantAnalytics, type TimeRange } from "../../providers/merchant-analytics";
import { useMerchantNavigation } from "../../providers/merchant-navigation";
import { useDashboardFormatters } from "../../lib/use-dashboard-formatters";
import { LiveLineChart } from "../../components/charts/dashboard-charts";
import { cx } from "../../lib/dashboard-utils";
import {
  Insight,
  KpiCard,
  PageTitle,
  Panel,
  PanelAction,
  ProductThumb,
  RecentOrderRow,
  StatusBadge,
  StatusDistributionBar
} from "../../components/ui/dashboard-ui";

export function OverviewScreen() {
  const t = useTranslations("dashboard");
  const format = useDashboardFormatters();
  const [timeRange, setTimeRange] = useState<TimeRange>("30days");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const analytics = useMerchantAnalytics(timeRange);
  const { navigate } = useMerchantNavigation();

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const timeRangeOptions: { value: TimeRange; labelKey: string }[] = [
    { value: "today", labelKey: "common.today" },
    { value: "week", labelKey: "common.week" },
    { value: "30days", labelKey: "common.30days" },
    { value: "6months", labelKey: "common.6months" },
    { value: "year", labelKey: "common.year" }
  ];

  const {
    metrics,
    revenueDelta,
    orderCountDelta,
    productCountDelta,
    pendingOrdersDelta,
    inventoryAlertsDelta,
    conversionDelta,
    revenueTrend,
    netSales,
    averageOrderValue,
    peakHour,
    statusDistribution,
    recentOrders,
    bestProducts
  } = analytics;

  const hasOrders = recentOrders.length > 0;
  const hasProducts = bestProducts.length > 0;

  return (
    <div className="space-y-6 sm:space-y-8 lg:space-y-10">
      <PageTitle
        actions={
          <div className="relative inline-block text-left" ref={dropdownRef}>
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-zinc-200 bg-white px-4 text-[13px] font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-950 focus:outline-none focus:ring-4 focus:ring-zinc-950/5 cursor-pointer"
              aria-expanded={isDropdownOpen}
              aria-haspopup="true"
              type="button"
            >
              <Clock3 size={14} className="text-zinc-500" />
              <span>{t(timeRangeOptions.find((o) => o.value === timeRange)?.labelKey as never)}</span>
              <ChevronDown size={14} className={cx("text-zinc-400 transition-transform duration-200", isDropdownOpen && "rotate-180")} />
            </button>

            {isDropdownOpen && (
              <div className="absolute right-0 mt-2 w-48 origin-top-right rounded-2xl border border-zinc-100 bg-white p-1.5 shadow-[0_12px_40px_-4px_rgba(15,23,42,0.06),0_4px_20px_-2px_rgba(15,23,42,0.02)] z-50">
                <div className="flex flex-col gap-0.5">
                  {timeRangeOptions.map((opt) => {
                    const isActive = opt.value === timeRange;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setTimeRange(opt.value);
                          setIsDropdownOpen(false);
                        }}
                        className={`flex items-center px-3 py-2 rounded-xl text-[13px] font-medium transition-all duration-200 cursor-pointer w-full text-left ${
                          isActive
                            ? "bg-zinc-900 text-white"
                            : "text-zinc-700 hover:bg-zinc-50 hover:text-zinc-950"
                        }`}
                        type="button"
                      >
                        {t(opt.labelKey as never)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        }
        eyebrow={t("overview.eyebrow")}
        title={t("overview.title")}
      />

      {/* ─── KPI Cards ─────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiCard label={t("overview.totalRevenue")} value={format.currency(metrics.revenue)} delta={revenueDelta} icon={Banknote} tone="positive" />
        <KpiCard label={t("overview.orders")} value={format.number(metrics.orderCount)} delta={orderCountDelta} icon={ReceiptText} tone="positive" />
        <KpiCard label={t("overview.products")} value={format.number(metrics.productCount)} delta={productCountDelta} icon={Package} tone="positive" />
        <KpiCard label={t("overview.pendingOrders")} value={format.number(metrics.pendingOrders)} delta={pendingOrdersDelta} icon={Clock3} tone={metrics.pendingOrders > 0 ? "urgent" : "positive"} />
        <KpiCard label={t("overview.inventoryAlerts")} value={format.number(metrics.inventoryAlerts)} delta={inventoryAlertsDelta} icon={Boxes} tone={metrics.inventoryAlerts > 0 ? "urgent" : "positive"} />
        <KpiCard label={t("common.conversion")} value={format.percent(metrics.conversion)} delta={conversionDelta} icon={Activity} tone="positive" />
      </section>

      {/* ─── Revenue Chart + Insights ──────────────────────── */}
      <section>
        <Panel
          action={<PanelAction onClick={() => navigate("analytics")} label={t("common.openAnalytics")} />}
          eyebrow={t("overview.revenueIntelligence")}
          title={t("overview.salesPerformance")}
        >
          {hasOrders ? (
            <LiveLineChart
              ariaLabel={t("analytics.revenueTrend")}
              data={revenueTrend}
              height={280}
              formatValue={(v) => format.currency(v)}
            />
          ) : (
            <div className="flex h-[280px] items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/40">
              <div className="text-center">
                <TrendingUp className="mx-auto text-zinc-300" size={32} />
                <p className="mt-3 text-[13px] font-medium text-zinc-400">No revenue data yet</p>
                <p className="mt-1 text-[11px] text-zinc-400">Revenue chart will appear once orders come in</p>
              </div>
            </div>
          )}
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Insight label={t("overview.netSales")} value={format.currency(netSales)} detail={t("common.bestHour", { timeRange: peakHour })} />
            <Insight label={t("overview.averageOrderValue")} value={format.currency(averageOrderValue)} detail={hasOrders ? `${recentOrders.length} recent orders` : "No orders yet"} />
            <Insight label={t("overview.traffic")} value={format.number(metrics.orderCount)} detail={`${statusDistribution.length} order statuses`} />
          </div>
        </Panel>
      </section>

      {/* ─── Recent Orders + Order Status ─────────────────── */}
      <section className="grid gap-6 lg:grid-cols-5">
        {/* recent orders — takes 3 cols */}
        <Panel
          className="lg:col-span-3"
          action={<PanelAction onClick={() => navigate("orders")} label={t("common.viewAll")} />}
          eyebrow={t("overview.latestActivity")}
          title={t("overview.recentOrders")}
        >
          {hasOrders ? (
            <div className="divide-y divide-zinc-100">
              {recentOrders.map((order) => (
                <RecentOrderRow
                  key={order.id}
                  customer={order.customer}
                  total={format.currency(order.total)}
                  status={order.status}
                  placedAt={order.placedAt}
                  items={order.items}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-[200px] items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/40">
              <div className="text-center">
                <ShoppingCart className="mx-auto text-zinc-300" size={28} />
                <p className="mt-2 text-[13px] font-medium text-zinc-400">No orders yet</p>
              </div>
            </div>
          )}
        </Panel>

        {/* order status distribution — takes 2 cols */}
        <Panel
          className="lg:col-span-2"
          eyebrow={t("overview.orderBreakdown")}
          title={t("overview.statusDistribution")}
        >
          {hasOrders && statusDistribution.length > 0 ? (
            <StatusDistributionBar data={statusDistribution} />
          ) : (
            <div className="flex h-[200px] items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50/40">
              <p className="text-[13px] font-medium text-zinc-400">No order data</p>
            </div>
          )}
        </Panel>
      </section>

      {/* ─── Best Selling Products ─────────────────────────── */}
      {hasProducts && (
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
      )}
    </div>
  );
}
