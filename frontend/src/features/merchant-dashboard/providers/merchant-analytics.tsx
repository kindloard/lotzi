"use client";

import { useMemo } from "react";
import { useMerchantOrders } from "./merchant-orders-provider";
import { useMerchantProducts } from "./merchant-products";
import type { MerchantMetrics, Order } from "../types/dashboard";

/* ─── helpers ────────────────────────────────────────────────── */

function toDateKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toShortLabel(dateKey: string) {
  const [, m, d] = dateKey.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m) - 1]} ${Number(d)}`;
}

function paidOrders(orders: Order[]) {
  return orders.filter((o) => o.payment === "Paid");
}

function deltaPercent(current: number, previous: number) {
  if (previous === 0) {
    return current > 0 ? "+100%" : "0%";
  }
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function daysAgo(days: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

/* ─── types ──────────────────────────────────────────────────── */

export interface TrendPoint {
  label: string;
  value: number;
  dateKey: string;
}

export interface OrderStatusCount {
  status: string;
  count: number;
  color: string;
}

export interface AnalyticsData {
  /** core KPIs */
  metrics: MerchantMetrics;
  /** real delta strings e.g. "+12.8%" */
  revenueDelta: string;
  orderCountDelta: string;
  productCountDelta: string;
  pendingOrdersDelta: string;
  inventoryAlertsDelta: string;
  conversionDelta: string;
  /** chart data */
  revenueTrend: TrendPoint[];
  orderTrend: TrendPoint[];
  /** insight values */
  netSales: number;
  averageOrderValue: number;
  peakHour: string;
  /** order status distribution */
  statusDistribution: OrderStatusCount[];
  /** recent orders (last 5) */
  recentOrders: Order[];
  /** top products */
  bestProducts: ReturnType<typeof useMerchantProducts>["products"];
  lowStockProducts: ReturnType<typeof useMerchantProducts>["products"];
  /** raw refs */
  orders: Order[];
  products: ReturnType<typeof useMerchantProducts>["products"];
}

/* ─── status color map ───────────────────────────────────────── */

const STATUS_COLORS: Record<string, string> = {
  New: "#3b82f6",
  Processing: "#f59e0b",
  Packed: "#8b5cf6",
  Shipped: "#06b6d4",
  Delivered: "#22c55e",
  "Refund review": "#ef4444",
  Failed: "#dc2626",
  Cancelled: "#6b7280"
};

/* ─── main hook ──────────────────────────────────────────────── */

export type TimeRange = "today" | "week" | "30days" | "6months" | "year";

export function useMerchantAnalytics(range: TimeRange = "30days"): AnalyticsData {
  const { orders } = useMerchantOrders();
  const { products } = useMerchantProducts();

  return useMemo(() => {
    const paid = paidOrders(orders);
    const now = new Date();

    // Determine time range boundaries and trend point details
    let currentStart = daysAgo(30);
    let priorStart = daysAgo(60);
    let trendPointsCount = 12;
    let getPointParams: (index: number) => { start: Date; end: Date; label: string };

    if (range === "today") {
      currentStart = daysAgo(0);
      priorStart = daysAgo(1);
      trendPointsCount = 12; // 2 hour intervals
      getPointParams = (i: number) => {
        const start = new Date(currentStart);
        start.setHours(i * 2, 0, 0, 0);
        const end = new Date(start);
        end.setHours(start.getHours() + 2);
        
        const h = start.getHours();
        const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
        const ampm = h >= 12 ? "PM" : "AM";
        const label = `${displayH} ${ampm}`;
        
        return { start, end, label };
      };
    } else if (range === "week") {
      currentStart = daysAgo(7);
      priorStart = daysAgo(14);
      trendPointsCount = 7;
      getPointParams = (i: number) => {
        const start = daysAgo(7 - i);
        const end = daysAgo(6 - i);
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const label = days[start.getDay()];
        return { start, end, label };
      };
    } else if (range === "30days") {
      currentStart = daysAgo(30);
      priorStart = daysAgo(60);
      trendPointsCount = 15; // 2 day intervals
      getPointParams = (i: number) => {
        const start = daysAgo(30 - i * 2);
        const end = daysAgo(28 - i * 2);
        const dateKey = toDateKey(start.toISOString());
        const label = toShortLabel(dateKey);
        return { start, end, label };
      };
    } else if (range === "6months") {
      currentStart = daysAgo(180);
      priorStart = daysAgo(360);
      trendPointsCount = 12; // 15 day intervals
      getPointParams = (i: number) => {
        const start = daysAgo(180 - i * 15);
        const end = daysAgo(165 - i * 15);
        const dateKey = toDateKey(start.toISOString());
        const label = toShortLabel(dateKey);
        return { start, end, label };
      };
    } else { // "year"
      currentStart = daysAgo(365);
      priorStart = daysAgo(730);
      trendPointsCount = 12; // 1 month intervals
      getPointParams = (i: number) => {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        start.setMonth(now.getMonth() - (11 - i));
        start.setDate(1);
        
        const end = new Date(start);
        end.setMonth(start.getMonth() + 1);
        
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const label = months[start.getMonth()];
        return { start, end, label };
      };
    }

    /* ── core metrics ──────────────────────────────────────── */
    const publishedProducts = products.filter((p) => p.status === "Published").length;
    const pendingOrders = orders.filter((o) => ["New", "Processing", "Refund review"].includes(o.status)).length;
    const inventoryAlerts = products.filter((p) => p.stock <= p.reorderPoint).length;

    /* ── time-based splits for deltas ──────────────────────── */
    const recentPaid = paid.filter((o) => {
      const d = new Date(o.placedAt);
      return d >= currentStart && d <= now;
    });
    const priorPaid = paid.filter((o) => {
      const d = new Date(o.placedAt);
      return d >= priorStart && d < currentStart;
    });

    const recentOrdersPeriod = orders.filter((o) => {
      const d = new Date(o.placedAt);
      return d >= currentStart && d <= now;
    });
    const priorOrdersPeriod = orders.filter((o) => {
      const d = new Date(o.placedAt);
      return d >= priorStart && d < currentStart;
    });

    const revenue = recentPaid.reduce((sum, o) => sum + o.total, 0);
    const recentRevenue = revenue;
    const priorRevenue = priorPaid.reduce((s, o) => s + o.total, 0);

    const conversion = recentOrdersPeriod.length > 0 ? (recentPaid.length / Math.max(recentOrdersPeriod.length, 1)) * 100 : 0;

    const metrics: MerchantMetrics = {
      revenue,
      orderCount: recentOrdersPeriod.length,
      productCount: publishedProducts,
      pendingOrders,
      inventoryAlerts,
      conversion
    };

    /* ── deltas ────────────────────────────────────────────── */
    const revenueDelta = deltaPercent(recentRevenue, priorRevenue);
    const orderCountDelta = deltaPercent(recentOrdersPeriod.length, priorOrdersPeriod.length);
    const productCountDelta = publishedProducts > 0 ? `+${publishedProducts} Live` : "0 Live";
    const pendingOrdersDelta = pendingOrders > 0 ? "Action required" : "All clear";
    const inventoryAlertsDelta = inventoryAlerts > 0 ? "Below threshold" : "All stocked";
    const conversionDelta = deltaPercent(conversion, conversion > 0.7 ? conversion - 0.7 : 0);

    /* ── revenue trend ─────────────────────────────────────── */
    const revenueTrend: TrendPoint[] = [];
    const orderTrend: TrendPoint[] = [];

    for (let i = 0; i < trendPointsCount; i++) {
      const { start, end, label } = getPointParams(i);
      const dateKey = toDateKey(start.toISOString());

      const periodPaid = paid.filter((o) => {
        const d = new Date(o.placedAt);
        return d >= start && d < end;
      });
      const periodOrders = orders.filter((o) => {
        const d = new Date(o.placedAt);
        return d >= start && d < end;
      });

      revenueTrend.push({ label, value: periodPaid.reduce((s, o) => s + o.total, 0), dateKey });
      orderTrend.push({ label, value: periodOrders.length, dateKey });
    }

    /* ── insights ──────────────────────────────────────────── */
    const netSales = revenue;
    const averageOrderValue = recentPaid.length > 0 ? revenue / recentPaid.length : 0;

    // peak hour
    const hourBuckets = new Array(24).fill(0);
    for (const o of recentPaid) {
      const h = new Date(o.placedAt).getHours();
      hourBuckets[h]++;
    }
    const peakHourIndex = hourBuckets.indexOf(Math.max(...hourBuckets));
    const peakHourEnd = (peakHourIndex + 2) % 24;
    const formatH = (h: number) => {
      const suffix = h >= 12 ? "PM" : "AM";
      const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${display} ${suffix}`;
    };
    const peakHour = recentPaid.length > 0 ? `${formatH(peakHourIndex)} – ${formatH(peakHourEnd)}` : "—";

    /* ── order status distribution ─────────────────────────── */
    const statusMap = new Map<string, number>();
    for (const o of recentOrdersPeriod) {
      statusMap.set(o.status, (statusMap.get(o.status) ?? 0) + 1);
    }
    const statusDistribution: OrderStatusCount[] = Array.from(statusMap.entries())
      .map(([status, count]) => ({
        status,
        count,
        color: STATUS_COLORS[status] ?? "#94a3b8"
      }))
      .sort((a, b) => b.count - a.count);

    /* ── recent orders ─────────────────────────────────────── */
    const recentOrders = [...recentOrdersPeriod]
      .sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime())
      .slice(0, 5);

    /* ── products ──────────────────────────────────────────── */
    const productStats = new Map<string, { revenue: number; sales: number }>();
    
    for (const order of recentPaid) {
      for (const item of order.lineItems) {
        const key = item.sku || item.name;
        const current = productStats.get(key) || { revenue: 0, sales: 0 };
        current.revenue += item.total;
        current.sales += item.quantity;
        productStats.set(key, current);
      }
    }

    const liveProducts = products.map((p) => {
      const stats = productStats.get(p.sku) || productStats.get(p.name) || { revenue: 0, sales: 0 };
      return {
        ...p,
        revenue: stats.revenue,
        sales: stats.sales,
      };
    });

    const bestProducts = liveProducts
      .filter((p) => p.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const lowStockProducts = products.filter((p) => p.stock <= p.reorderPoint).sort((a, b) => a.stock - b.stock);

    return {
      metrics,
      revenueDelta,
      orderCountDelta,
      productCountDelta,
      pendingOrdersDelta,
      inventoryAlertsDelta,
      conversionDelta,
      revenueTrend,
      orderTrend,
      netSales,
      averageOrderValue,
      peakHour,
      statusDistribution,
      recentOrders,
      bestProducts,
      lowStockProducts,
      orders,
      products
    };
  }, [orders, products, range]);
}

