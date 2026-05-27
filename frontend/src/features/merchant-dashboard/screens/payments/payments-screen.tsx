"use client";

import { Banknote, Clock3, ReceiptText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMerchantOrders } from "../../providers/merchant-orders-provider";
import { useDashboardFormatters } from "../../lib/use-dashboard-formatters";
import { Insight, KpiCard, PageTitle, Panel } from "../../components/ui/dashboard-ui";

export function PaymentsScreen() {
  const t = useTranslations("dashboard");
  const format = useDashboardFormatters();
  const { orders } = useMerchantOrders();
  const paid = orders.filter((item) => item.payment === "Paid").reduce((total, item) => total + item.total, 0);
  return (
    <div className="space-y-6">
      <PageTitle eyebrow={t("payments.eyebrow")} title={t("payments.title")} />
      <section className="grid gap-5 lg:grid-cols-3">
        <KpiCard label={t("payments.availableBalance")} value={format.currency(paid * 0.82)} delta={t("status.readyNextPayout")} icon={Banknote} tone="positive" />
        <KpiCard label={t("payments.pendingSettlement")} value={format.currency(paid * 0.18)} delta={t("status.tPlusOneEstimate")} icon={Clock3} />
        <KpiCard label={t("payments.refundReview")} value={format.currency(orders.filter((item) => item.status === "Refund review").reduce((sum, item) => sum + item.total, 0))} delta={t("status.actionRequired")} icon={ReceiptText} tone="urgent" />
      </section>
      <Panel eyebrow={t("payments.settlement")} title={t("payments.payoutTimeline")}>
        <div className="grid gap-5 md:grid-cols-3">
          <Insight label={t("payments.today")} value={format.currency(18420)} detail={t("payments.capturedPayments")} />
          <Insight label={t("payments.tomorrow")} value={format.currency(76580)} detail={t("payments.expectedPayout")} />
          <Insight label={t("payments.bank")} value={t("payments.bankEnding", { digits: "4205" })} detail={t("payments.verifiedAccount")} />
        </div>
      </Panel>
    </div>
  );
}

