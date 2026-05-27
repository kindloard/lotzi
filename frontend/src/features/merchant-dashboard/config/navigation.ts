import {
  Activity,
  Banknote,
  Boxes,
  LayoutDashboard,
  Package,
  ReceiptText,
  Settings,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { routing } from "@/i18n/routing";
import type { NavId } from "../types/dashboard";
import { navTranslationKeys } from "../lib/dashboard-i18n";

export const navItems: Array<{ id: NavId; labelKey: string; icon: LucideIcon; shortcut: string }> = [
  { id: "dashboard", labelKey: navTranslationKeys.dashboard, icon: LayoutDashboard, shortcut: "G D" },
  { id: "products", labelKey: navTranslationKeys.products, icon: Package, shortcut: "G P" },
  { id: "orders", labelKey: navTranslationKeys.orders, icon: ReceiptText, shortcut: "G O" },
  { id: "analytics", labelKey: navTranslationKeys.analytics, icon: Activity, shortcut: "G A" },
  { id: "customers", labelKey: navTranslationKeys.customers, icon: Users, shortcut: "G C" },
  { id: "inventory", labelKey: navTranslationKeys.inventory, icon: Boxes, shortcut: "G I" },
  { id: "payments", labelKey: navTranslationKeys.payments, icon: Banknote, shortcut: "G M" },
  { id: "settings", labelKey: navTranslationKeys.settings, icon: Settings, shortcut: "G S" }
];

export const navLabelKeyById = navItems.reduce<Record<NavId, string>>((labels, item) => {
  labels[item.id] = item.labelKey;
  return labels;
}, {} as Record<NavId, string>);

export const SHOW_DASHBOARD_SEARCH_COMMAND = false;

export const merchantRoutes: Record<NavId, string> = {
  dashboard: "/merchant/dashboard",
  products: "/merchant/products",
  orders: "/merchant/orders",
  analytics: "/merchant/analytics",
  customers: "/merchant/customers",
  inventory: "/merchant/inventory",
  payments: "/merchant/payments",
  settings: "/merchant/settings"
};

export function routeForNav(nav: NavId) {
  return merchantRoutes[nav];
}

export function navFromMerchantPath(pathname: string): NavId | null {
  const withoutLocale = stripLocalePrefix(pathname);
  const normalizedPath = withoutLocale.endsWith("/") && withoutLocale !== "/" ? withoutLocale.slice(0, -1) : withoutLocale;
  const match = Object.entries(merchantRoutes).find(([, route]) => route === normalizedPath);
  return match ? (match[0] as NavId) : null;
}

function stripLocalePrefix(pathname: string) {
  const [, maybeLocale, ...rest] = pathname.split("/");
  if (routing.locales.includes(maybeLocale as never)) {
    return `/${rest.join("/")}`;
  }
  return pathname;
}

