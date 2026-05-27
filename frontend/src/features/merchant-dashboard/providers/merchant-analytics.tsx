"use client";

import { useMemo } from "react";
import { useMerchantOrders } from "./merchant-orders-provider";
import { useMerchantProducts } from "./merchant-products";
import type { MerchantMetrics } from "../types/dashboard";

export function useMerchantAnalytics() {
  const { orders } = useMerchantOrders();
  const { products } = useMerchantProducts();

  const metrics = useMemo<MerchantMetrics>(() => {
    const revenue = orders
      .filter((item) => item.payment === "Paid")
      .reduce((total, item) => total + item.total, 0);
    const pendingOrders = orders.filter((item) => ["New", "Processing", "Refund review"].includes(item.status)).length;
    const inventoryAlerts = products.filter((item) => item.stock <= item.reorderPoint).length;
    const publishedProducts = products.filter((item) => item.status === "Published").length;
    const conversion = 5.8 + publishedProducts * 0.08;

    return {
      revenue,
      orderCount: orders.length,
      productCount: publishedProducts,
      pendingOrders,
      inventoryAlerts,
      conversion
    };
  }, [orders, products]);

  const lowStockProducts = useMemo(
    () => products.filter((item) => item.stock <= item.reorderPoint).sort((a, b) => a.stock - b.stock),
    [products]
  );

  const bestProducts = useMemo(
    () => [...products].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    [products]
  );

  return {
    bestProducts,
    lowStockProducts,
    metrics,
    orders,
    products
  };
}
