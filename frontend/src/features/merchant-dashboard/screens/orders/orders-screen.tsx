"use client";

import { ChevronLeft, ChevronRight, Download, Eye, FileText, MoreHorizontal, Truck, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/toast/toast-context";
import type { OrderStatus } from "../../types/dashboard";
import { useMerchantOrders } from "../../providers/merchant-orders-provider";
import { useMerchantShellUi } from "../../providers/merchant-shell-ui-provider";
import { orderStatusValues } from "../../lib/dashboard-i18n";
import { useDashboardFormatters } from "../../lib/use-dashboard-formatters";
import {
  DashboardButton,
  IconButton,
  PageTitle,
  Panel,
  SegmentedControl,
  StatusBadge,
  Toolbar
} from "../../components/ui/dashboard-ui";

export function OrdersScreen() {
  const t = useTranslations("dashboard");
  const format = useDashboardFormatters();
  const toast = useToast();
  const { globalQuery } = useMerchantShellUi();
  const { markOrdersPacked, moveOrdersToRefundReview, openOrder, orders } = useMerchantOrders();
  const [status, setStatus] = useState<OrderStatus | "All">("All");
  const [sort, setSort] = useState<"newest" | "value">("newest");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const pageSize = 7;

  const filtered = useMemo(() => {
    const q = globalQuery.trim().toLowerCase();
    return orders
      .filter((item) => {
        const statusMatch = status === "All" || item.status === status;
        const queryMatch = !q || [item.id, item.customer, item.email, item.city, item.status].some((value) => value.toLowerCase().includes(q));
        return statusMatch && queryMatch;
      })
      .sort((a, b) => sort === "value" ? b.total - a.total : Date.parse(b.placedAt) - Date.parse(a.placedAt));
  }, [globalQuery, orders, sort, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);

  useEffect(() => {
    setPage(1);
    setSelected([]);
  }, [globalQuery, status, sort]);

  const toggle = (id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const cancelSelected = () => {
    if (!selected.length) {
      toast.warning(t("toasts.selectOrdersFirst"));
      return;
    }
    moveOrdersToRefundReview(selected);
    setSelected([]);
  };

  return (
    <div className="space-y-6">
      <PageTitle
        actions={
          <>
            <DashboardButton icon={Download} label={t("orders.export")} variant="secondary" onClick={() => toast.success(t("toasts.exportQueued"))} />
            <DashboardButton icon={Truck} label={t("orders.bulkFulfill")} onClick={() => markOrdersPacked(selected)} />
          </>
        }
        eyebrow={t("orders.eyebrow")}
        title={t("orders.title")}
      />

      <Toolbar>
        <SegmentedControl
          options={orderStatusValues.map((value) => ({
            label: t((value === "All" ? "status.all" : `status.${value === "Refund review" ? "refundReview" : value.toLowerCase()}`) as never),
            value
          }))}
          value={status}
          onChange={(value) => setStatus(value as OrderStatus | "All")}
        />
        <div className="flex gap-2 w-full justify-between sm:justify-end lg:w-auto lg:ml-auto">
          <select
            className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-700 outline-none transition focus:border-zinc-950 focus:ring-4 focus:ring-zinc-950/5"
            onChange={(event) => setSort(event.target.value as "newest" | "value")}
            value={sort}
          >
            <option value="newest">{t("orders.newestFirst")}</option>
            <option value="value">{t("orders.highestValue")}</option>
          </select>
          <DashboardButton icon={X} label={t("orders.cancelReview")} onClick={cancelSelected} variant="secondary" />
        </div>
      </Toolbar>

      <Panel title={t("orders.queue")} eyebrow={t("common.orders", { count: filtered.length })}>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                <th className="pb-3 border-b border-zinc-100"><span className="sr-only">{t("orders.columns.select")}</span></th>
                <th className="pb-3 border-b border-zinc-100">{t("orders.columns.order")}</th>
                <th className="pb-3 border-b border-zinc-100">{t("orders.columns.customer")}</th>
                <th className="pb-3 border-b border-zinc-100">{t("orders.columns.status")}</th>
                <th className="pb-3 border-b border-zinc-100">{t("orders.columns.payment")}</th>
                <th className="pb-3 text-right border-b border-zinc-100">{t("orders.columns.total")}</th>
                <th className="pb-3 text-right border-b border-zinc-100">{t("orders.columns.placed")}</th>
                <th className="pb-3 text-right border-b border-zinc-100">{t("orders.columns.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {visible.map((item) => (
                <tr
                  className="focus-within:bg-zinc-50/50 hover:bg-zinc-50/50 transition-colors"
                  key={item.id}
                  tabIndex={0}
                  onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                    if (event.key === "Enter") {
                      openOrder(item);
                    }
                  }}
                >
                  <td className="py-3.5 pr-3">
                    <input
                      aria-label={t("orders.selectOrder", { id: item.id })}
                      checked={selected.includes(item.id)}
                      className="size-4 rounded border-zinc-300 accent-zinc-950 focus:ring-zinc-950/5"
                      onChange={() => toggle(item.id)}
                      type="checkbox"
                    />
                  </td>
                  <td className="py-3.5 pr-4">
                    <p className="text-[13px] font-semibold text-zinc-950 font-mono">{item.id}</p>
                    <p className="text-[11px] font-normal text-zinc-500">{t("common.items", { count: item.items })} - {item.channel}</p>
                  </td>
                  <td className="py-3.5 pr-4">
                    <p className="text-[13px] font-semibold text-zinc-900">{item.customer}</p>
                    <p className="text-[11px] font-normal text-zinc-500">{item.city}</p>
                  </td>
                  <td className="py-3.5"><StatusBadge label={item.status} /></td>
                  <td className="py-3.5"><StatusBadge label={item.payment} /></td>
                  <td className="py-3.5 text-[13px] font-medium text-zinc-900 text-right tabular-nums">{format.currency(item.total)}</td>
                  <td className="py-3.5 text-[13px] font-normal text-zinc-500 text-right">{format.relativeDate(item.placedAt)}</td>
                  <td className="py-3.5">
                    <div className="flex justify-end gap-1.5">
                        <IconButton label={t("orders.openOrder")} onClick={() => openOrder(item)}>
                        <Eye size={14} />
                      </IconButton>
                      <IconButton label={t("orders.printInvoice")} onClick={() => toast.success(t("toasts.invoiceGenerated"))}>
                        <FileText size={14} />
                      </IconButton>
                      <IconButton label={t("orders.moreActions")}>
                        <MoreHorizontal size={14} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-2 md:hidden">
          {visible.map((item) => (
            <button
              className="w-full rounded-xl border border-zinc-200 bg-white p-4 text-left transition hover:bg-zinc-50/50"
              key={item.id}
              onClick={() => openOrder(item)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-zinc-950 font-mono">{item.id} - {item.customer}</p>
                  <p className="mt-1 text-[11px] font-normal text-zinc-500">{t("common.items", { count: item.items })} - {format.currency(item.total)}</p>
                </div>
                <StatusBadge label={item.status} />
              </div>
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-zinc-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] font-normal text-zinc-500">
            {t("common.showing", { visible: visible.length, total: filtered.length, selected: selected.length })}
          </p>
          <div className="flex gap-2 items-center">
            <IconButton label={t("orders.previousPage")} onClick={() => setPage(Math.max(1, page - 1))}>
              <ChevronLeft size={14} />
            </IconButton>
            <span className="flex h-9 items-center rounded-xl border border-zinc-200 bg-white px-3 text-[11px] font-medium text-zinc-600 font-mono">
              {t("common.pageOf", { page, pageCount })}
            </span>
            <IconButton label={t("orders.nextPage")} onClick={() => setPage(Math.min(pageCount, page + 1))}>
              <ChevronRight size={14} />
            </IconButton>
          </div>
        </div>
      </Panel>
    </div>
  );
}

