"use client";

import { useTranslations } from "next-intl";
import { useMerchantOrders } from "../../providers/merchant-orders-provider";
import { initials } from "../../lib/dashboard-utils";
import { useDashboardFormatters } from "../../lib/use-dashboard-formatters";
import { Insight, PageTitle, Panel } from "../../components/ui/dashboard-ui";

export function CustomersScreen() {
  const t = useTranslations("dashboard");
  const format = useDashboardFormatters();
  const { orders } = useMerchantOrders();
  const customers = Array.from(new Map(orders.map((item) => [item.email, item])).values());
  return (
    <div className="space-y-6">
      <PageTitle eyebrow={t("customers.eyebrow")} title={t("customers.title")} />
      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel eyebrow={t("common.customers", { count: customers.length })} title={t("customers.customerList")}>
          <div className="divide-y divide-zinc-100">
            {customers.map((item) => (
              <div className="flex items-center gap-3 py-3.5" key={item.email}>
                <span className="flex size-9 items-center justify-center rounded-xl bg-zinc-950 text-[11px] font-semibold text-white font-mono">
                  {initials(item.customer)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-zinc-950">{item.customer}</p>
                  <p className="truncate text-[11px] font-normal text-zinc-500">{item.email} - {item.city}</p>
                </div>
                <p className="text-[13px] font-semibold text-zinc-950 tabular-nums">{format.currency(item.total)}</p>
              </div>
            ))}
          </div>
        </Panel>
        <Panel eyebrow={t("customers.segments")} title={t("customers.customerQuality")}>
          <div className="space-y-4">
            <Insight label={t("customers.vipCustomers")} value={format.number(18)} detail={t("customers.highValueRepeatBuyers")} />
            <Insight label={t("customers.atRiskCustomers")} value={format.number(7)} detail={t("customers.noOrderInDays", { days: 60 })} />
            <Insight label={t("customers.newThisWeek")} value={format.number(42)} detail={t("customers.acquiredThroughMobile")} />
          </div>
        </Panel>
      </section>
    </div>
  );
}

