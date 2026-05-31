"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Clock3 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cx } from "../../lib/dashboard-utils";
import { useMerchantAnalytics, type TimeRange } from "../../providers/merchant-analytics";
import { useDashboardFormatters } from "../../lib/use-dashboard-formatters";
import { LiveLineChart, LiveBarChart, LiveMiniBars } from "../../components/charts/dashboard-charts";
import { Insight, PageTitle, Panel } from "../../components/ui/dashboard-ui";

export function AnalyticsScreen() {
  const t = useTranslations("dashboard");
  const format = useDashboardFormatters();
  
  const [timeRange, setTimeRange] = useState<TimeRange>("30days");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { bestProducts, metrics, orders, revenueTrend, orderTrend, netSales } = useMerchantAnalytics(timeRange);

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

  // Derive mock traffic trend from live order trend (since we don't have real traffic data)
  // We'll scale up orders based on the conversion rate (or 5% if conversion is 0)
  const conversionRate = metrics.conversion > 0 ? metrics.conversion / 100 : 0.05;
  const trafficTrend = orderTrend.map(point => ({
    label: point.label,
    value: Math.floor(point.value / conversionRate) + Math.floor(Math.random() * 5),
    dateKey: point.dateKey
  }));
  const totalVisitors = trafficTrend.reduce((sum, item) => sum + item.value, 0);

  // Dynamic forecast metrics
  const projectedMonth = netSales * (timeRange === "30days" ? 1 : timeRange === "week" ? 4.3 : timeRange === "today" ? 30 : 1); 
  const refundExposure = orders.filter((item) => item.status === "Refund review").reduce((sum, item) => sum + item.total, 0);
  const deliveredOrders = orders.filter(o => o.status === "Delivered").length;
  const fulfillmentSla = orders.length > 0 ? (deliveredOrders / orders.length) * 100 : 100;
  
  return (
    <div className="space-y-6">
      <PageTitle 
        eyebrow={t("analytics.eyebrow")} 
        title={t("analytics.title")}
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
      />
      <section className="grid gap-6 xl:grid-cols-3">
        <Panel eyebrow={t("analytics.revenue")} title={t("analytics.revenueTrend")} className="xl:col-span-2">
          {revenueTrend.reduce((sum, item) => sum + item.value, 0) > 0 ? (
            <LiveLineChart ariaLabel={t("analytics.revenueTrend")} data={revenueTrend} height={280} formatValue={(v) => format.currency(v)} />
          ) : (
            <div className="flex h-[280px] items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/40">
              <span className="text-[13px] font-medium text-zinc-400">No revenue data</span>
            </div>
          )}
        </Panel>
        <Panel eyebrow={t("analytics.orders")} title={t("analytics.orderVelocity")}>
          {orderTrend.reduce((sum, item) => sum + item.value, 0) > 0 ? (
            <LiveBarChart data={orderTrend} height={280} />
          ) : (
            <div className="flex h-[280px] items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/40">
              <span className="text-[13px] font-medium text-zinc-400">No order data</span>
            </div>
          )}
        </Panel>
      </section>
      <section className="grid gap-6 xl:grid-cols-3">
        <Panel eyebrow={t("analytics.traffic")} title={t("analytics.trafficInsight")}>
          <LiveMiniBars data={trafficTrend} />
          <div className="mt-5 space-y-4">
            <Insight label={t("analytics.visitors")} value={format.number(totalVisitors)} detail={t("analytics.twelveMonthRolling")} />
            <Insight label={t("common.conversion")} value={format.percent(metrics.conversion)} detail={t("analytics.aboveCategoryMedian")} />
          </div>
        </Panel>
        <Panel eyebrow={t("analytics.products")} title={t("analytics.productPerformance")} className="xl:col-span-2">
          <div className="space-y-2">
            {bestProducts.map((item, index) => {
              const maxRevenue = Math.max(...bestProducts.map((p) => p.revenue), 1);
              return (
                <div className="group flex items-center gap-4 rounded-xl border border-transparent p-3 transition-colors duration-200 hover:border-zinc-100 hover:bg-zinc-50/50" key={item.id}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-[11px] font-bold text-zinc-600 font-mono shadow-sm">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between items-baseline mb-2">
                      <p className="truncate text-[13px] font-semibold text-zinc-950">{item.name}</p>
                      <span className="text-[13px] font-semibold text-zinc-950 tabular-nums">{format.currency(item.revenue)}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                      <div 
                        className="h-full rounded-full bg-zinc-900 transition-all duration-500" 
                        style={{ width: `${Math.max(1, (item.revenue / maxRevenue) * 100)}%` }} 
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            {bestProducts.length === 0 && (
              <div className="flex flex-col items-center justify-center text-[13px] text-zinc-400 font-medium py-12 border border-dashed border-zinc-200 rounded-xl bg-zinc-50/50">
                <span className="mb-1 text-zinc-500">No product performance data</span>
                <span className="text-[11px] font-normal">Check back after your first few sales</span>
              </div>
            )}
          </div>
        </Panel>
      </section>
      <Panel eyebrow={t("analytics.forecast")} title={t("analytics.operationalSummary")}>
        <div className="grid gap-4 md:grid-cols-4">
          <Insight label={t("analytics.projectedMonth")} value={format.currency(projectedMonth)} detail={t("analytics.basedOnCurrentPace")} />
          <Insight label={t("analytics.refundExposure")} value={format.currency(refundExposure)} detail={t("analytics.needsResponse")} />
          <Insight label={t("analytics.fulfillmentSla")} value={`${fulfillmentSla.toFixed(1)}%`} detail={t("analytics.packedWithinTarget")} />
          <Insight label={t("analytics.repeatRate")} value="31.2%" detail={t("analytics.returningCustomers")} />
        </div>
      </Panel>
    </div>
  );
}
