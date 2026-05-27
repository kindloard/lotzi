import { FileText, Truck, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Order } from "../../types/dashboard";
import { dashboardStatusKey, timelineEventKey } from "../../lib/dashboard-i18n";
import { useDashboardFormatters } from "../../lib/use-dashboard-formatters";
import { DashboardButton, Insight } from "../ui/dashboard-ui";

export function OrderDrawer({
  onClose,
  onMarkPacked,
  order
}: {
  onClose: () => void;
  onMarkPacked: (orderId: string) => void;
  order: Order;
}) {
  const t = useTranslations("dashboard");
  const format = useDashboardFormatters();
  const orderStatusKey = dashboardStatusKey(order.status);
  const paymentStatusKey = dashboardStatusKey(order.payment);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-950/40 backdrop-blur-sm">
      <button aria-label={t("orders.drawer.closeBackdrop")} className="absolute inset-0 cursor-default" onClick={onClose} type="button" />
      <aside className="relative z-10 flex h-full w-full max-w-xl flex-col bg-white shadow-2xl border-l border-zinc-200">
        <div className="flex items-center justify-between border-b border-zinc-200 p-5 sm:p-6">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{t("orders.drawer.title")}</p>
            <h2 className="text-xl font-semibold tracking-tight text-zinc-950 font-mono">{order.id}</h2>
          </div>
          <button
            aria-label={t("common.close")}
            className="flex size-9 items-center justify-center rounded-xl border border-zinc-200 text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 transition-colors"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Insight label={t("orders.drawer.customer")} value={order.customer} detail={order.email} />
            <Insight label={t("orders.drawer.total")} value={format.currency(order.total)} detail={t("common.items", { count: order.items })} />
            <Insight label={t("orders.drawer.shipping")} value={orderStatusKey ? t(orderStatusKey as never) : order.status} detail={order.city} />
            <Insight label={t("orders.drawer.payment")} value={paymentStatusKey ? t(paymentStatusKey as never) : order.payment} detail={order.channel} />
          </div>
          <div className="mt-8">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{t("orders.drawer.timeline")}</h3>
            <div className="mt-4 space-y-4">
              {order.timeline.map((item, index) => (
                <div className="flex gap-3" key={`${item.label}-${index}`}>
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-zinc-950" />
                  <div>
                    <p className="text-[13px] font-semibold text-zinc-950">{t(timelineEventKey(item.label) as never)}</p>
                    <p className="text-[11px] font-normal text-zinc-500">{format.dateTime(item.at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="grid gap-3 border-t border-zinc-200 p-5 sm:p-6 sm:grid-cols-3">
          <DashboardButton icon={Truck} label={t("orders.drawer.markPacked")} onClick={() => onMarkPacked(order.id)} />
          <DashboardButton icon={FileText} label={t("orders.drawer.invoice")} variant="secondary" />
          <DashboardButton icon={X} label={t("orders.drawer.refundReview")} variant="secondary" />
        </div>
      </aside>
    </div>
  );
}

