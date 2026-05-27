"use client";

import { useTranslations } from "next-intl";
import { orderTrend, revenueTrend, trafficTrend } from "../../data/chart-data";
import { useMerchantAnalytics } from "../../providers/merchant-analytics";
import { useDashboardFormatters } from "../../lib/use-dashboard-formatters";
import { BarChart, LineChart, MiniBars } from "../../components/charts/dashboard-charts";
import { Insight, PageTitle, Panel } from "../../components/ui/dashboard-ui";

export function AnalyticsScreen() {
  const t = useTranslations("dashboard");
  const format = useDashboardFormatters();
  const { bestProducts, metrics, orders } = useMerchantAnalytics();
  return (
    <div className="space-y-6">
      <PageTitle eyebrow={t("analytics.eyebrow")} title={t("analytics.title")} />
      <section className="grid gap-6 xl:grid-cols-3">
        <Panel eyebrow={t("analytics.revenue")} title={t("analytics.revenueTrend")} className="xl:col-span-2">
          <LineChart ariaLabel={t("analytics.revenueTrend")} data={revenueTrend} height={280} />
        </Panel>
        <Panel eyebrow={t("analytics.orders")} title={t("analytics.orderVelocity")}>
          <BarChart data={orderTrend} height={280} />
        </Panel>
      </section>
      <section className="grid gap-6 xl:grid-cols-3">
        <Panel eyebrow={t("analytics.traffic")} title={t("analytics.trafficInsight")}>
          <MiniBars data={trafficTrend} />
          <div className="mt-5 space-y-4">
            <Insight label={t("analytics.visitors")} value="50.1k" detail={t("analytics.twelveMonthRolling")} />
            <Insight label={t("common.conversion")} value={format.percent(metrics.conversion)} detail={t("analytics.aboveCategoryMedian")} />
          </div>
        </Panel>
        <Panel eyebrow={t("analytics.products")} title={t("analytics.productPerformance")} className="xl:col-span-2">
          <div className="space-y-4">
            {bestProducts.map((item, index) => (
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4" key={item.id}>
                <span className="flex size-7 items-center justify-center rounded-lg bg-zinc-100 text-[11px] font-semibold text-zinc-700 font-mono">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-zinc-950">{item.name}</p>
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                    <div className="h-full rounded-full bg-zinc-950" style={{ width: `${Math.min(100, item.conversion * 9)}%` }} />
                  </div>
                </div>
                <span className="text-[13px] font-semibold text-zinc-950 tabular-nums">{format.currency(item.revenue)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </section>
      <Panel eyebrow={t("analytics.forecast")} title={t("analytics.operationalSummary")}>
        <div className="grid gap-4 md:grid-cols-4">
          <Insight label={t("analytics.projectedMonth")} value={format.currency(orders.reduce((sum, item) => sum + item.total, 0) * 4)} detail={t("analytics.basedOnCurrentPace")} />
          <Insight label={t("analytics.refundExposure")} value={format.currency(orders.filter((item) => item.status === "Refund review").reduce((sum, item) => sum + item.total, 0))} detail={t("analytics.needsResponse")} />
          <Insight label={t("analytics.fulfillmentSla")} value="96.4%" detail={t("analytics.packedWithinTarget")} />
          <Insight label={t("analytics.repeatRate")} value="31.2%" detail={t("analytics.returningCustomers")} />
        </div>
      </Panel>
    </div>
  );
}

