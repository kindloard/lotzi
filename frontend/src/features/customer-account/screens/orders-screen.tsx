"use client";

import { 
  Package, 
  Search, 
  Copy, 
  Check, 
  HelpCircle, 
  ChevronDown, 
  RefreshCw, 
  MapPin, 
  CreditCard,
  X,
  Store
} from "lucide-react";
import { useFormatter } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchCustomerOrders, CustomerOrder } from "../customer-account-api";
import { SectionError, SectionSkeleton } from "../components/account-ui";
import { accountOrdersKey } from "../lib/account-query-keys";
import { currency, formatDate } from "../lib/account-utils";
import { useToast } from "@/components/toast/toast-context";
import { useCart } from "@/lib/cart-context";
import { checkoutPaymentSummary } from "@/lib/payment-display";

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
    const purchasableItems = order.items.filter((item) => item.variantId);
    purchasableItems.forEach(item => {
      addToCart({
        id: item.productId,
        variantId: item.variantId ?? undefined,
        name: item.name,
        price: item.unitPrice,
        shop: order.store.name,
        shopId: order.store.id,
        imageBg: "bg-slate-100 text-slate-700",
        imageInitials: item.name.substring(0, 2).toUpperCase()
      });
    });
    if (purchasableItems.length) {
      toast.success(`Added ${purchasableItems.length} items from ${order.store.name} to basket!`);
    } else {
      toast.error("These items are no longer available to reorder.");
    }
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

  const getTabCategory = (status: string): "IN_PROGRESS" | "COMPLETED" | "CANCELLED" => {
    const s = status.toUpperCase();
    if (s === "COMPLETED" || s === "DELIVERED") return "COMPLETED";
    if (s === "CANCELLED" || s === "REFUNDED") return "CANCELLED";
    return "IN_PROGRESS";
  };

  const filteredOrders = orders.filter(order => {
    if (activeTab !== "ALL") {
      const category = getTabCategory(order.status);
      if (category !== activeTab) return false;
    }
    
    if (searchQuery.trim()) {
      const queryLower = searchQuery.toLowerCase();
      const storeMatch = order.store.name.toLowerCase().includes(queryLower);
      const itemsMatch = order.items.some(item => item.name.toLowerCase().includes(queryLower));
      const orderIdMatch = order.id.toLowerCase().includes(queryLower);
      return storeMatch || itemsMatch || orderIdMatch;
    }
    
    return true;
  });

  const counts = {
    ALL: orders.length,
    IN_PROGRESS: orders.filter(o => getTabCategory(o.status) === "IN_PROGRESS").length,
    COMPLETED: orders.filter(o => getTabCategory(o.status) === "COMPLETED").length,
    CANCELLED: orders.filter(o => getTabCategory(o.status) === "CANCELLED").length,
  };

  const getStatusBadge = (status: string) => {
    const s = status.toUpperCase();
    
    if (s === "COMPLETED" || s === "DELIVERED") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-emerald-400/20 to-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 text-[11px] font-black text-emerald-700 shadow-[0_0_10px_rgba(16,185,129,0.1)]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-50"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          {status}
        </span>
      );
    }
    
    if (s === "CANCELLED" || s === "REFUNDED") {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-rose-400/10 to-rose-500/5 border border-rose-500/20 px-3 py-1.5 text-[11px] font-black text-rose-700">
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500"></span>
          {status}
        </span>
      );
    }
    
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-400/20 to-amber-500/10 border border-amber-500/30 px-3 py-1.5 text-[11px] font-black text-amber-700 shadow-[0_0_10px_rgba(245,158,11,0.1)]">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-50"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
        </span>
        {status}
      </span>
    );
  };

  if (!orders.length) {
    return (
      <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-white to-slate-50/50 p-12 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white/60">
        <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-indigo-500/5 blur-3xl"></div>
        <div className="absolute -bottom-24 -left-24 h-48 w-48 rounded-full bg-rose-500/5 blur-3xl"></div>
        
        <div className="relative mx-auto flex h-24 w-24 items-center justify-center rounded-3xl bg-white shadow-xl shadow-slate-200/50 mb-6">
          <Package className="text-slate-400" size={36} strokeWidth={1.5} />
        </div>
        <h3 className="text-xl font-black tracking-tight text-slate-900">No orders yet</h3>
        <p className="mt-2 text-sm font-medium text-slate-500 max-w-sm mx-auto leading-relaxed">
          When you place orders, they will appear here. Start exploring our premium local stores to find something great.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10">
      
      {/* Search and Filters Header - Glassmorphic */}
      <div className="sticky top-4 z-20 flex flex-col gap-5 rounded-[2rem] border border-white/60 bg-white/70 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.06)] backdrop-blur-xl">
        {/* Search Field */}
        <div className="relative flex w-full items-center">
          <Search className="absolute left-4 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search by shop name, item, or order ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-12 w-full rounded-2xl border border-slate-200/60 bg-white/50 pl-11 pr-11 text-sm font-semibold text-slate-900 outline-none transition-all placeholder:text-slate-400 hover:bg-white focus:border-indigo-500/30 focus:bg-white focus:ring-4 focus:ring-indigo-500/10"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-4 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              title="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Tab Filters */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {(["ALL", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const).map((tab) => {
            const isActive = activeTab === tab;
            const label = tab === "ALL" ? "All Orders" : tab === "IN_PROGRESS" ? "In Progress" : tab === "COMPLETED" ? "Completed" : "Cancelled";
            const count = counts[tab];
            
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`group relative flex h-10 shrink-0 cursor-pointer items-center gap-2 overflow-hidden rounded-xl border px-4 py-2 text-xs font-bold transition-all duration-300 ${
                  isActive
                    ? "border-black bg-black text-white shadow-md shadow-black/20"
                    : "border-slate-200/60 bg-white/60 text-slate-600 hover:bg-white hover:text-black hover:shadow-sm"
                }`}
              >
                <span className="relative z-10">{label}</span>
                <span className={`relative z-10 inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[9px] font-black transition-colors ${
                  isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700"
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
        <div className="space-y-5">
          {filteredOrders.map((order) => {
            const isExpanded = !!expandedOrders[order.id];
            const displayId = order.id.substring(0, 8).toUpperCase();
            const initials = order.store.name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();

            return (
              <article 
                className="group relative overflow-hidden rounded-[2rem] border border-slate-200 bg-white p-1 shadow-sm transition-all duration-300" 
                key={order.id}
              >
                <div className="rounded-[1.75rem] bg-white p-5 sm:p-6">
                  {/* Order Top Summary */}
                  <div className="flex flex-col gap-4 border-b border-slate-100/80 pb-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-4">
                      {/* Premium Store Avatar */}
                      <div className="relative flex size-14 shrink-0 items-center justify-center rounded-2xl bg-black text-sm font-black text-white shadow-sm overflow-hidden">
                        <span className="relative z-10 tracking-wider">{initials}</span>
                      </div>
                      
                      <div className="pt-0.5">
                        <h2 className="text-lg font-black tracking-tight text-black group-hover:text-black transition-colors flex items-center gap-1.5">
                          {order.store.name}
                          <Store size={14} className="text-slate-300" />
                        </h2>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs font-semibold text-slate-500">
                          <span className="flex items-center gap-1.5">
                            <div className="size-1.5 rounded-full bg-slate-200"></div>
                            {formatDate(formatter, order.createdAt)}
                          </span>
                          
                          <button
                            onClick={() => handleCopyId(order.id)}
                            className="group/id flex cursor-pointer items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 transition-colors hover:bg-slate-100 hover:text-slate-900"
                            title="Copy Full Reference ID"
                          >
                            <span className="font-mono tracking-tight">#{displayId}</span>
                            {copiedId === order.id ? (
                              <Check size={12} className="text-emerald-500" />
                            ) : (
                              <Copy size={12} className="text-slate-400 transition-colors group-hover/id:text-indigo-500" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    <div className="self-start mt-1 sm:mt-0">
                      {getStatusBadge(order.status)}
                    </div>
                  </div>

                  {/* Minimal Items Preview */}
                  <div className="py-4">
                    <div className="flex flex-wrap gap-2">
                      {order.items.map((item) => (
                        <div key={item.id} className="flex items-center gap-2 rounded-xl border border-slate-100/50 bg-slate-50/50 px-3 py-2 text-xs transition-colors hover:bg-slate-50">
                          <span className="font-bold text-slate-400">{item.quantity}x</span>
                          <span className="font-bold text-slate-700">{item.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Expandable Details Area */}
                  <div className={`grid transition-all duration-300 ease-in-out ${isExpanded ? "grid-rows-[1fr] opacity-100 mt-2" : "grid-rows-[0fr] opacity-0"}`}>
                    <div className="overflow-hidden">
                      <div className="rounded-2xl border border-slate-100/80 bg-slate-50/50 p-5 mt-2 shadow-inner shadow-slate-100/50">
                        {/* Cost Breakdown */}
                        <div className="grid gap-3.5 border-b border-slate-200/60 pb-4 text-xs font-semibold text-slate-500">
                          <div className="flex justify-between items-center">
                            <span>Subtotal ({order.items.length} items)</span>
                            <span className="text-slate-900 font-bold">{currency(formatter, order.subtotal)}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span>Delivery Fee</span>
                            <span className="text-slate-900 font-bold">{order.deliveryFee === 0 ? "Free" : currency(formatter, order.deliveryFee)}</span>
                          </div>
                          <div className="flex justify-between items-center text-sm font-black text-black pt-2 mt-1 border-t border-dashed border-slate-200">
                            <span>Grand Total</span>
                            <span className="text-black">{currency(formatter, order.total)}</span>
                          </div>
                        </div>

                        {/* Logistics */}
                        <div className="grid gap-6 pt-4 sm:grid-cols-2 text-xs font-semibold text-slate-500">
                          <div className="space-y-2">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                              <CreditCard size={12} /> Payment
                            </p>
                            <p className="text-slate-800 font-bold">
                              {checkoutPaymentSummary({ method: order.paymentMethod, status: order.paymentStatus })}
                            </p>
                          </div>

                          <div className="space-y-2">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                              <MapPin size={12} /> Delivery Address
                            </p>
                            <div className="text-slate-800 leading-relaxed">
                              <p className="font-bold">{order.address.recipientName || "Recipient"}</p>
                              <p className="text-slate-600 mt-0.5">{order.address.line1}, {[order.address.city, order.address.pincode].filter(Boolean).join(", ")}</p>
                            </div>
                          </div>
                        </div>

                        {order.customerNote && (
                          <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 text-xs font-semibold text-indigo-900/80 shadow-sm">
                            <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-indigo-500/80">Note</p>
                            &quot;{order.customerNote}&quot;
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Bottom Action Bar */}
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleReorder(order)}
                        className="group flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl bg-black px-5 text-xs font-bold text-white shadow-md shadow-black/20 transition-all hover:bg-neutral-800 hover:shadow-lg hover:shadow-black/30 active:scale-95"
                      >
                        <RefreshCw size={14} className="transition-transform group-hover:rotate-180 duration-500" />
                        Reorder All
                      </button>
                      <button
                        onClick={() => handleSupportRequest(order.id)}
                        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:scale-95"
                        title="Need Help with Order"
                      >
                        <HelpCircle size={16} />
                      </button>
                    </div>

                    <button
                      onClick={() => toggleExpand(order.id)}
                      className="group flex h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white/50 px-4 text-xs font-bold text-slate-600 transition-all hover:bg-white hover:text-slate-900 hover:shadow-sm"
                    >
                      <span className="tracking-tight">{isExpanded ? "Less Details" : "Full Details"}</span>
                      <ChevronDown size={14} className={`transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`} />
                    </button>
                  </div>

                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-[2rem] border border-white/60 bg-white/70 p-12 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-50 text-slate-300 mb-5 shadow-inner">
            <Search size={32} strokeWidth={2} />
          </div>
          <h3 className="text-lg font-black tracking-tight text-slate-900">No matching orders</h3>
          <p className="mt-2 text-sm font-semibold text-slate-500 max-w-sm mx-auto">
            We couldn&apos;t find any orders matching &quot;{searchQuery}&quot; under the &quot;{activeTab.toLowerCase().replace("_", " ")}&quot; filter.
          </p>
        </div>
      )}

    </div>
  );
}
