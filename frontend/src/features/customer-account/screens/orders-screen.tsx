"use client";

import { Package } from "lucide-react";
import { useFormatter } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { fetchCustomerOrders } from "../customer-account-api";
import { EmptyState, SectionError, SectionSkeleton } from "../components/account-ui";
import { accountOrdersKey } from "../lib/account-query-keys";
import { currency, formatDate } from "../lib/account-utils";

export function OrdersScreen() {
  const formatter = useFormatter();
  const query = useQuery({ queryKey: accountOrdersKey, queryFn: () => fetchCustomerOrders() });

  if (query.isLoading) {
    return <SectionSkeleton />;
  }

  if (query.isError) {
    return (
      <SectionError
        title="Orders could not load"
        body="Your profile is still available. Retry only this section."
        onRetry={() => void query.refetch()}
      />
    );
  }

  const orders = query.data?.orders ?? [];
  if (!orders.length) {
    return <EmptyState icon={Package} title="No orders yet" body="Your completed and in-progress orders will show up here." />;
  }

  return (
    <div className="space-y-4">
      {orders.map((order) => (
        <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm" key={order.id}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                {formatDate(formatter, order.createdAt)}
              </p>
              <h2 className="mt-1 text-base font-semibold text-zinc-950">{order.store.name}</h2>
              <p className="mt-1 text-sm text-zinc-500">
                {order.items.length} items - {order.paymentStatus}
              </p>
            </div>
            <span className="w-fit rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-700">
              {order.status}
            </span>
          </div>
          <div className="mt-4 divide-y divide-zinc-100">
            {order.items.slice(0, 3).map((item) => (
              <div className="flex items-center justify-between gap-3 py-2 text-sm" key={item.id}>
                <span className="min-w-0 truncate text-zinc-700">
                  {item.quantity} x {item.name}
                </span>
                <span className="shrink-0 font-semibold text-zinc-950">{currency(formatter, item.total)}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-lg bg-zinc-50 p-3">
            <span className="text-sm font-semibold text-zinc-600">Total</span>
            <span className="text-lg font-semibold text-zinc-950">{currency(formatter, order.total)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}
