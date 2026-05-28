"use client";

import { 
  Package, 
  Search, 
  Copy, 
  Check, 
  HelpCircle, 
  ChevronDown, 
  ChevronUp, 
  RefreshCw, 
  MapPin, 
  CreditCard,
  X
} from "lucide-react";
import { useFormatter } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchCustomerOrders, CustomerOrder } from "../customer-account-api";
import { EmptyState, SectionError, SectionSkeleton } from "../components/account-ui";
import { accountOrdersKey } from "../lib/account-query-keys";
import { currency, formatDate } from "../lib/account-utils";
import { useToast } from "@/components/toast/toast-context";
import { useCart } from "@/lib/cart-context";

export function OrdersScreen() {
  const formatter = useFormatter();
  const toast = useToast();
  const { addToCart } = useCart();
  
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"ALL" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED">("ALL");
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const query = useQuery({ 
    queryKey: accountOrdersKey, 
    queryFn: () => fetchCustomerOrders() 
  });

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

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    toast.success("Order Reference ID copied!");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleReorder = (order: CustomerOrder) => {
    order.items.forEach(item => {
      addToCart({
        id: item.productId,
        name: item.name,
        price: item.unitPrice,
        shop: order.store.name,
        shopId: order.store.id,
        imageBg: "bg-slate-100 text-slate-700",
        imageInitials: item.name.substring(0, 2).toUpperCase()
      });
    });
    toast.success(`Added ${order.items.length} items from ${order.store.name} to basket!`);
  };

  const handleSupportRequest = (orderId: string) => {
    toast.success(`Support request created for Order #${orderId.substring(0, 8)}`);
  };

  const toggleExpand = (orderId: string) => {
    setExpandedOrders(prev => ({
      ...prev,
      [orderId]: !prev[orderId]
    }));
  };

  // Helper to map order status to tabs
  const getTabCategory = (status: string): "IN_PROGRESS" | "COMPLETED" | "CANCELLED" => {
    const s = status.toUpperCase();
    if (s === "COMPLETED" || s === "DELIVERED") return "COMPLETED";
    if (s === "CANCELLED" || s === "REFUNDED") return "CANCELLED";
    return "IN_PROGRESS";
  };

  // Filter orders
  const filteredOrders = orders.filter(order => {
    // 1. Tab filter
    if (activeTab !== "ALL") {
      const category = getTabCategory(order.status);
      if (category !== activeTab) return false;
    }
    
    // 2. Search query filter
    if (searchQuery.trim()) {
      const queryLower = searchQuery.toLowerCase();
      const storeMatch = order.store.name.toLowerCase().includes(queryLower);
      const itemsMatch = order.items.some(item => item.name.toLowerCase().includes(queryLower));
      const orderIdMatch = order.id.toLowerCase().includes(queryLower);
      return storeMatch || itemsMatch || orderIdMatch;
    }
    
    return true;
  });

  // Calculate counts for badges
  const counts = {
    ALL: orders.length,
    IN_PROGRESS: orders.filter(o => getTabCategory(o.status) === "IN_PROGRESS").length,
    COMPLETED: orders.filter(o => getTabCategory(o.status) === "COMPLETED").length,
    CANCELLED: orders.filter(o => getTabCategory(o.status) === "CANCELLED").length,
  };

  // Get status color styles
  const getStatusStyle = (status: string) => {
    const s = status.toUpperCase();
    if (s === "COMPLETED" || s === "DELIVERED") {
      return "bg-emerald-50/15 text-emerald-700 border border-emerald-500/20";
    }
    if (s === "CANCELLED" || s === "REFUNDED") {
      return "bg-rose-50/15 text-rose-700 border border-rose-500/20";
    }
    return "bg-amber-50/15 text-amber-700 border border-amber-500/20";
  };

  if (!orders.length) {
    return (
      <EmptyState 
        icon={Package} 
        title="No orders yet" 
        body="Your completed and in-progress orders will show up here." 
      />
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Search and Filters Header */}
      <div className="flex flex-col gap-4 bg-white p-4.5 rounded-2xl border border-zinc-200 shadow-sm">
        {/* Search Field */}
        <div className="relative flex items-center w-full">
          <Search className="absolute left-3.5 text-zinc-400" size={17} />
          <input
            type="text"
            placeholder="Search by shop name, item, or order ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-11 pl-10 pr-10 rounded-xl border border-zinc-200 bg-zinc-50/50 text-sm font-semibold outline-none transition focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/5 placeholder:text-zinc-400"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3.5 p-1 rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition cursor-pointer"
              title="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Tab Filters */}
        <div className="flex overflow-x-auto gap-2 pb-1 scrollbar-hide">
          {(["ALL", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const).map((tab) => {
            const isActive = activeTab === tab;
            const label = tab === "ALL" ? "All Orders" : tab === "IN_PROGRESS" ? "In Progress" : tab === "COMPLETED" ? "Completed" : "Cancelled";
            const count = counts[tab];
            
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-2 px-4 py-2 h-9 rounded-xl border transition-all shrink-0 font-bold text-xs cursor-pointer ${
                  isActive
                    ? "bg-zinc-950 border-zinc-950 text-white shadow-sm"
                    : "bg-white hover:bg-zinc-50 border-zinc-200 text-zinc-650 hover:text-zinc-950"
                }`}
              >
                <span>{label}</span>
                <span className={`inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full text-[10px] font-black ${
                  isActive ? "bg-white/20 text-white" : "bg-zinc-150 text-zinc-600"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Orders List */}
      {filteredOrders.length > 0 ? (
        <div className="space-y-4">
          {filteredOrders.map((order) => {
            const isExpanded = !!expandedOrders[order.id];
            const displayId = order.id.substring(0, 8).toUpperCase();
            
            // Extract store name initials for store placeholder
            const initials = order.store.name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();

            return (
              <article 
                className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm hover:shadow-md transition duration-200 relative overflow-hidden" 
                key={order.id}
              >
                {/* Order Top Summary */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between border-b border-zinc-100 pb-4">
                  <div className="flex items-start gap-4">
                    {/* Dynamic colored avatar based on store name */}
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-800 to-slate-950 text-white font-black text-sm shadow-sm">
                      {initials}
                    </div>
                    <div>
                      <h2 className="text-base font-extrabold text-zinc-950">{order.store.name}</h2>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-xs text-zinc-500 font-semibold">
                        <span>{formatDate(formatter, order.createdAt)}</span>
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 hidden sm:block" />
                        <button
                          onClick={() => handleCopyId(order.id)}
                          className="inline-flex items-center gap-1 hover:text-zinc-900 group/id cursor-pointer text-left"
                          title="Copy Full Reference ID"
                        >
                          <span className="font-mono">Ref: #{displayId}</span>
                          {copiedId === order.id ? (
                            <Check size={11} className="text-emerald-600" />
                          ) : (
                            <Copy size={11} className="text-zinc-400 group-hover/id:text-zinc-650 transition" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  {/* Status Badge */}
                  <span className={`w-fit self-start rounded-full px-3 py-1.5 text-xs font-bold ${getStatusStyle(order.status)}`}>
                    {order.status}
                  </span>
                </div>

                {/* Items Listing */}
                <div className="py-2.5 divide-y divide-zinc-100/60">
                  {order.items.map((item) => (
                    <div className="flex items-center justify-between gap-3 py-3 text-sm" key={item.id}>
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Bullet product initials badge placeholder */}
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-50 border border-zinc-100 text-[10px] font-black text-zinc-600 uppercase">
                          {item.name.substring(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <span className="font-bold text-zinc-800 truncate block">
                            {item.name}
                          </span>
                          {item.unitDisplay && (
                            <span className="text-[10px] font-bold text-zinc-400 bg-zinc-100 rounded px-1.5 py-0.5 mt-0.5 inline-block">
                              {item.unitDisplay}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 flex items-baseline gap-2">
                        <span className="text-xs font-semibold text-zinc-400">{item.quantity} x</span>
                        <span className="font-bold text-zinc-950">{currency(formatter, item.total)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Accordion Expandable cost & logistics details */}
                {isExpanded && (
                  <div className="mt-3 bg-zinc-50/70 border border-zinc-100 rounded-2xl p-4.5 space-y-4 animate-scale-up">
                    {/* Cost Breakdown Grid */}
                    <div className="grid gap-3 border-b border-zinc-200/50 pb-3.5 text-xs font-semibold text-zinc-500">
                      <div className="flex justify-between">
                        <span>Subtotal ({order.items.length} items)</span>
                        <span className="text-zinc-950 font-bold">{currency(formatter, order.subtotal)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Delivery Fee</span>
                        <span className="text-zinc-950 font-bold">{order.deliveryFee === 0 ? "Free" : currency(formatter, order.deliveryFee)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-extrabold text-zinc-950 pt-1 border-t border-dashed border-zinc-200">
                        <span>Grand Total</span>
                        <span>{currency(formatter, order.total)}</span>
                      </div>
                    </div>

                    {/* Logistics and Notes details */}
                    <div className="grid gap-4 sm:grid-cols-2 text-xs font-semibold text-zinc-500">
                      {/* Payment info */}
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Payment Information</p>
                        <div className="flex items-center gap-2 text-zinc-900">
                          <CreditCard size={14} className="text-zinc-400" />
                          <span>{order.paymentMethod} · {order.paymentStatus}</span>
                        </div>
                      </div>

                      {/* Delivery Address */}
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-black uppercase tracking-wider text-zinc-400">Delivery Address</p>
                        <div className="flex items-start gap-2 text-zinc-900">
                          <MapPin size={14} className="text-zinc-400 mt-0.5 shrink-0" />
                          <div className="leading-relaxed text-left">
                            <p className="font-bold text-zinc-950">{order.address.recipientName || "Recipient"}</p>
                            <p className="mt-0.5">{order.address.line1}</p>
                            <p>{[order.address.city, order.address.state, order.address.pincode].filter(Boolean).join(", ")}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Customer Notes */}
                    {order.customerNote && (
                      <div className="bg-amber-50/50 border border-amber-100/50 rounded-xl p-3 text-xs font-semibold text-amber-900/90 leading-relaxed text-left">
                        <p className="text-[10px] font-black uppercase tracking-wider text-amber-700/80 mb-1">Customer Note</p>
                        &quot;{order.customerNote}&quot;
                      </div>
                    )}
                  </div>
                )}

                {/* Bottom Action Bar */}
                <div className="mt-4 pt-4 border-t border-zinc-150/70 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleReorder(order)}
                      className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-zinc-950 bg-zinc-950 px-4 text-xs font-bold text-white shadow-sm hover:bg-zinc-900 transition active:scale-95 cursor-pointer"
                      title="Add all items to basket"
                    >
                      <RefreshCw size={13} />
                      Reorder All
                    </button>
                    <button
                      onClick={() => handleSupportRequest(order.id)}
                      className="inline-flex h-9 size-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition cursor-pointer"
                      title="Need Help with Order"
                    >
                      <HelpCircle size={15} />
                    </button>
                  </div>

                  <button
                    onClick={() => toggleExpand(order.id)}
                    className="inline-flex h-9 items-center gap-1.5 px-3 rounded-xl border border-zinc-200 bg-white text-xs font-bold text-zinc-650 hover:bg-zinc-50 hover:text-zinc-950 transition cursor-pointer"
                  >
                    <span>{isExpanded ? "Hide Details" : "View Details"}</span>
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>

              </article>
            );
          })}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-zinc-200 p-12 text-center shadow-sm">
          <Package className="mx-auto text-zinc-300 mb-3" size={32} />
          <h3 className="text-base font-extrabold text-zinc-950">No orders found</h3>
          <p className="mt-1 text-sm text-zinc-500 max-w-sm mx-auto">
            We couldn&apos;t find any orders matching &quot;{searchQuery}&quot; under the &quot;{activeTab.toLowerCase().replace("_", " ")}&quot; filter.
          </p>
        </div>
      )}

    </div>
  );
}
