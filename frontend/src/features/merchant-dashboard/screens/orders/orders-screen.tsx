"use client";

import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Download, Eye, FileText, Loader2, MoreHorizontal, PackageOpen, RefreshCw, Truck, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/toast/toast-context";
import { useRouter } from "@/i18n/navigation";
import { fetchMerchantOrder } from "@/lib/merchant-dashboard-api";
import type { Order, OrderStatus } from "../../types/dashboard";
import { useMerchantIdentity } from "../../providers/merchant-identity-provider";
import { useMerchantOrders } from "../../providers/merchant-orders-provider";
import { useMerchantShellUi } from "../../providers/merchant-shell-ui-provider";
import { dashboardStatusKey, orderStatusValues, timelineEventKey } from "../../lib/dashboard-i18n";
import { toDashboardOrder } from "../../lib/order-mappers";
import { useDashboardFormatters } from "../../lib/use-dashboard-formatters";
import {
  DashboardButton,
  EmptyState,
  IconButton,
  Insight,
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
  const router = useRouter();
  const params = useParams<{ orderId?: string | string[] }>();
  const routeOrderId = Array.isArray(params.orderId) ? params.orderId[0] ?? null : params.orderId ?? null;
  const isDetailRoute = Boolean(routeOrderId);
  const identity = useMerchantIdentity();
  const { globalQuery } = useMerchantShellUi();
  const {
    errorMessage,
    isLoading,
    isRefreshing,
    isUpdating,
    markOrdersPacked,
    moveOrdersToRefundReview,
    orders,
    retry
  } = useMerchantOrders();
  const [status, setStatus] = useState<OrderStatus | "All">("All");
  const [sort, setSort] = useState<"newest" | "value">("newest");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const pageSize = 7;

  const cachedDetailOrder = useMemo(
    () => routeOrderId ? orders.find((order) => order.id === routeOrderId) : undefined,
    [orders, routeOrderId]
  );
  const detailQuery = useQuery({
    enabled: identity.isReady && Boolean(routeOrderId),
    initialData: cachedDetailOrder,
    queryKey: ["merchant", "orders", identity.storeId, "detail", routeOrderId],
    queryFn: async ({ signal }) => {
      if (!routeOrderId) {
        throw new Error("Order ID is required.");
      }
      const response = await fetchMerchantOrder(routeOrderId, { signal });
      return toDashboardOrder(response.order);
    }
  });
  const detailOrder = routeOrderId ? detailQuery.data ?? cachedDetailOrder ?? null : null;

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
    if (isDetailRoute) {
      return;
    }
    setPage(1);
    setSelected([]);
  }, [globalQuery, isDetailRoute, orders, status, sort]);

  const toggle = (id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const openOrderPage = (id: string) => {
    router.push(`/merchant/orders/${encodeURIComponent(id)}`);
  };

  const backToOrders = () => {
    router.push("/merchant/orders");
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
          isDetailRoute ? undefined : (
            <>
              <DashboardButton icon={Download} label={t("orders.export")} variant="secondary" onClick={() => toast.success(t("toasts.exportQueued"))} />
              <DashboardButton disabled={isLoading || isUpdating} icon={Truck} label={t("orders.bulkFulfill")} onClick={() => markOrdersPacked(selected)} />
            </>
          )
        }
        eyebrow={t("orders.eyebrow")}
        title={isDetailRoute ? t("orders.detailTitle") : t("orders.title")}
      />

      {!isDetailRoute && (
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
          <DashboardButton disabled={isLoading || isUpdating} icon={X} label={t("orders.cancelReview")} onClick={cancelSelected} variant="secondary" />
        </div>
      </Toolbar>
      )}

      <Panel
        action={isDetailRoute ? (
          <div className="hidden lg:block">
            <DashboardButton icon={ArrowLeft} label={t("orders.backToOrders")} onClick={backToOrders} variant="secondary" />
          </div>
        ) : undefined}
        headerClassName={isDetailRoute ? "hidden lg:flex" : undefined}
        title={isDetailRoute ? t("orders.detailTitle") : t("orders.queue")}
        eyebrow={isDetailRoute && routeOrderId ? shortOrderId(routeOrderId) : t("common.orders", { count: filtered.length })}
      >
        {isDetailRoute ? (
          <OrderDetailPage
            errorMessage={detailQuery.isError ? detailErrorMessage(detailQuery.error, t("orders.detailLoadFailed")) : null}
            isLoading={detailQuery.isLoading && !detailOrder}
            isRefreshing={detailQuery.isFetching && Boolean(detailOrder)}
            onBack={backToOrders}
            onMarkPacked={(orderId) => markOrdersPacked([orderId])}
            onRefundReview={(orderId) => moveOrdersToRefundReview([orderId])}
            onRetry={() => void detailQuery.refetch()}
            onInvoice={() => toast.success(t("toasts.invoiceGenerated"))}
            order={detailOrder}
          />
        ) : (
          <>
            {isRefreshing && !isLoading && (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[12px] font-medium text-zinc-600">
                <Loader2 className="animate-spin" size={14} />
                Refreshing live orders
              </div>
            )}

            {errorMessage ? (
              <EmptyState
                actionIcon={RefreshCw}
                actionLabel="Retry"
                body={errorMessage}
                icon={AlertTriangle}
                onAction={retry}
                title={t("orders.emptyTitle")}
              />
            ) : isLoading ? (
              <div className="flex min-h-[260px] items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-sm font-medium text-zinc-500">
                <Loader2 className="mr-2 animate-spin" size={16} />
                Loading live orders
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                body={t("orders.emptyDescription")}
                icon={PackageOpen}
                title={t("orders.emptyTitle")}
              />
            ) : (
              <>
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
                  className="cursor-pointer focus-within:bg-zinc-50/50 hover:bg-zinc-50/50 transition-colors"
                  key={item.id}
                  onClick={(event) => {
                    if (!isInteractiveTarget(event.target)) {
                      openOrderPage(item.id);
                    }
                  }}
                  tabIndex={0}
                  onKeyDown={(event: KeyboardEvent<HTMLTableRowElement>) => {
                    if (event.key === "Enter" && event.target === event.currentTarget) {
                      openOrderPage(item.id);
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
                    <button
                      className="font-mono text-[13px] font-semibold text-zinc-950 underline-offset-4 transition hover:underline focus:outline-none focus:ring-4 focus:ring-zinc-950/5"
                      onClick={() => openOrderPage(item.id)}
                      title={item.id}
                      type="button"
                    >
                      {shortOrderId(item.id)}
                    </button>
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
                      <IconButton label={t("orders.openOrder")} onClick={() => openOrderPage(item.id)}>
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
              onClick={() => openOrderPage(item.id)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-zinc-950">
                    <span className="font-mono">{shortOrderId(item.id)}</span> - {item.customer}
                  </p>
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
              </>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

function OrderDetailPage({
  errorMessage,
  isLoading,
  isRefreshing,
  onBack,
  onInvoice,
  onMarkPacked,
  onRefundReview,
  onRetry,
  order
}: {
  errorMessage: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  onBack: () => void;
  onInvoice: () => void;
  onMarkPacked: (orderId: string) => void;
  onRefundReview: (orderId: string) => void;
  onRetry: () => void;
  order: Order | null;
}) {
  const t = useTranslations("dashboard");
  const format = useDashboardFormatters();

  if (isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-sm font-medium text-zinc-500">
        <Loader2 className="mr-2 animate-spin" size={16} />
        Loading order details
      </div>
    );
  }

  if (errorMessage) {
    return (
      <EmptyState
        actionIcon={RefreshCw}
        actionLabel="Retry"
        body={errorMessage}
        icon={AlertTriangle}
        onAction={onRetry}
        title={t("orders.detailNotFoundTitle")}
      />
    );
  }

  if (!order) {
    return (
      <EmptyState
        actionIcon={ArrowLeft}
        actionLabel={t("orders.backToOrders")}
        body={t("orders.detailNotFoundDescription")}
        icon={PackageOpen}
        onAction={onBack}
        title={t("orders.detailNotFoundTitle")}
      />
    );
  }

  const orderStatusKey = dashboardStatusKey(order.status);
  const paymentStatusKey = dashboardStatusKey(order.payment);

  return (
    <div className="space-y-6">
      {isRefreshing && (
        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[12px] font-medium text-zinc-600">
          <Loader2 className="animate-spin" size={14} />
          Refreshing order details
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{t("orders.drawer.title")}</p>
          <h3 className="mt-1 font-mono text-xl font-semibold tracking-tight text-zinc-950">{shortOrderId(order.id)}</h3>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <StatusBadge label={order.status} />
          <StatusBadge label={order.payment} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Insight label={t("orders.drawer.customer")} value={order.customer} detail={order.email} />
        <Insight label={t("orders.drawer.total")} value={format.currency(order.total)} detail={t("common.items", { count: order.items })} />
        <Insight label={t("orders.drawer.shipping")} value={orderStatusKey ? t(orderStatusKey as never) : order.status} detail={order.city} />
        <Insight label={t("orders.drawer.payment")} value={paymentStatusKey ? t(paymentStatusKey as never) : order.payment} detail={order.channel} />
      </div>

      <OrderLineItemsPanel order={order} />

      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{t("orders.drawer.timeline")}</h3>
        <div className="mt-4 space-y-4">
          {order.timeline.map((item, index) => (
            <div className="flex gap-3" key={`${item.label}-${item.at}-${index}`}>
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-zinc-950" />
              <div>
                <p className="text-[13px] font-semibold text-zinc-950">{t(timelineEventKey(item.label) as never)}</p>
                <p className="text-[11px] font-normal text-zinc-500">{format.dateTime(item.at)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 border-t border-zinc-100 pt-5 sm:grid-cols-4">
        <DashboardButton icon={ArrowLeft} label={t("orders.backToOrders")} onClick={onBack} variant="secondary" />
        <DashboardButton icon={Truck} label={t("orders.drawer.markPacked")} onClick={() => onMarkPacked(order.id)} />
        <DashboardButton icon={FileText} label={t("orders.drawer.invoice")} onClick={onInvoice} variant="secondary" />
        <DashboardButton icon={X} label={t("orders.drawer.refundReview")} onClick={() => onRefundReview(order.id)} variant="secondary" />
      </div>
    </div>
  );
}

function OrderLineItemsPanel({ order }: { order: Order }) {
  const t = useTranslations("dashboard");
  const format = useDashboardFormatters();
  const totalUnits = order.lineItems.reduce((total, line) => total + line.quantity, 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-zinc-100 bg-zinc-50/70 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{t("orders.drawer.packingList")}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-700">
            {t("orders.drawer.productCount", { count: order.lineItems.length })}
          </span>
          <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-700">
            {t("orders.drawer.unitCount", { count: totalUnits })}
          </span>
        </div>
      </div>

      {order.lineItems.length === 0 ? (
        <p className="m-4 rounded-lg bg-zinc-50 px-3 py-3 text-[12px] font-medium text-zinc-500">{t("orders.drawer.noLineItems")}</p>
      ) : (
        <div className="divide-y divide-zinc-100">
          {order.lineItems.map((line, index) => (
            <div className="flex flex-col gap-3.5 p-4 sm:grid sm:grid-cols-[24px_72px_minmax(0,1fr)_96px_112px_112px] sm:items-center sm:gap-4" key={line.id}>
              <div className="flex items-center gap-3 sm:contents">
                <span className="font-mono text-[13px] font-medium text-zinc-400 tabular-nums sm:text-center shrink-0">
                  {index + 1}
                </span>
                <ProductLineImage imageUrl={line.imageUrl} name={line.name} />
                <div className="min-w-0 flex-1">
                  <p className="min-w-0 truncate text-[14px] font-semibold text-zinc-950">{line.name}</p>
                  <p className="mt-0.5 truncate text-[12px] font-normal text-zinc-500">
                    {[line.variantName, line.unitDisplay].filter(Boolean).join(" - ") || t("orders.drawer.productLine")}
                  </p>
                  {line.sku && (
                    <p className="mt-0.5 font-mono text-[11px] font-medium text-zinc-400">{t("orders.drawer.sku")}: {line.sku}</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 border-t border-zinc-100 pt-3.5 sm:contents sm:border-0 sm:pt-0">
                <MetricTile label={t("orders.drawer.quantity")} value={`x${line.quantity}`} />
                <MetricTile label={t("orders.drawer.unitPrice")} value={format.currency(line.unitPrice)} />
                <MetricTile label={t("orders.drawer.lineTotal")} value={format.currency(line.total)} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductLineImage({ imageUrl, name }: { imageUrl: string | null; name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "PR";

  return (
    <div
      aria-label={name}
      className="flex size-[72px] shrink-0 items-center justify-center rounded-xl bg-zinc-100 bg-cover bg-center text-[12px] font-semibold text-zinc-500"
      role="img"
      style={imageUrl ? { backgroundImage: `url("${imageUrl.replace(/"/g, '\\"')}")` } : undefined}
    >
      {!imageUrl && initials}
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col justify-center sm:text-right">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-zinc-950">{value}</p>
    </div>
  );
}

function shortOrderId(id: string) {
  return id.replace(/-/g, "").slice(0, 8) || id.slice(0, 8);
}

function detailErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("button,input,a,select,textarea"));
}

