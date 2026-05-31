"use client";

import {
  ArrowLeft,
  Bell,
  CircleHelp,
  Command,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Store,
  X
} from "lucide-react";
import type { MutableRefObject } from "react";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { navItems, navLabelKeyById, SHOW_DASHBOARD_SEARCH_COMMAND } from "../../config/navigation";
import type { MerchantChrome, MerchantChromeStatus, NavId } from "../../types/dashboard";
import { cx, initials } from "../../lib/dashboard-utils";

export function DashboardHeader({
  activeNav,
  globalQuery,
  onCommand,
  onMobileMenu,
  searchRef,
  setGlobalQuery,
  overrideTitle,
  onBack,
  hideActions
}: {
  activeNav: NavId;
  globalQuery: string;
  onCommand: () => void;
  onMobileMenu: () => void;
  searchRef: MutableRefObject<HTMLInputElement | null>;
  setGlobalQuery: (value: string) => void;
  overrideTitle?: string;
  onBack?: () => void;
  hideActions?: boolean;
}) {
  const t = useTranslations("dashboard");
  const activeLabel = t(navLabelKeyById[activeNav] as never);

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-900 bg-zinc-950 text-white backdrop-blur-md md:border-zinc-200/80 md:bg-white/95 md:text-zinc-900">
      <div className="mx-auto flex h-[72px] max-w-[1520px] items-center gap-3 px-5 sm:px-8 lg:h-[80px] lg:px-10">
        {onBack ? (
          <button
            aria-label={t("orders.backToOrders")}
            className="flex size-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white shadow-none transition hover:bg-white/15 focus:outline-none focus:ring-4 focus:ring-white/10 md:border-zinc-200 md:bg-white md:text-zinc-900 md:shadow-sm md:hover:border-zinc-300 md:hover:bg-white md:focus:ring-zinc-950/5 lg:hidden"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft size={16} />
          </button>
        ) : (
          <button
            aria-label={t("shell.openNavigation")}
            className="flex size-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white shadow-none transition hover:bg-white/15 focus:outline-none focus:ring-4 focus:ring-white/10 md:border-zinc-200 md:bg-white md:text-zinc-900 md:shadow-sm md:hover:border-zinc-300 md:hover:bg-white md:focus:ring-zinc-950/5 lg:hidden"
            onClick={onMobileMenu}
            type="button"
          >
            <Menu size={16} />
          </button>
        )}

        <div className="min-w-0 lg:hidden">
          <h1 className="truncate text-base font-semibold tracking-tight text-white md:text-zinc-950">{overrideTitle || activeLabel}</h1>
        </div>

        {SHOW_DASHBOARD_SEARCH_COMMAND && (
          <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex lg:max-w-[420px]">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">{t("shell.globalSearch")}</span>
              <input
                className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50/50 px-4 text-[13px] font-normal text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:bg-white focus:ring-4 focus:ring-zinc-950/5"
                onChange={(event) => setGlobalQuery(event.target.value)}
                placeholder={t("shell.searchAnything")}
                ref={searchRef}
                type="search"
                value={globalQuery}
              />
            </label>
            <button
              aria-label={t("shell.openCommandMenu")}
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 text-[11px] font-semibold text-zinc-600 shadow-sm transition hover:border-zinc-300 hover:text-zinc-950 focus:outline-none focus:ring-4 focus:ring-zinc-950/5"
              onClick={onCommand}
              type="button"
            >
              <Command size={14} />
              Ctrl K
            </button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {!hideActions && (
            <>
              <LanguageSwitcher
                compact
                className="flex size-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white shadow-none transition hover:bg-white/15 focus:outline-none focus:ring-4 focus:ring-white/10 md:border-zinc-200 md:bg-white md:text-zinc-600 md:shadow-sm md:hover:border-zinc-300 md:hover:bg-white md:hover:text-zinc-950 md:focus:ring-zinc-950/5 cursor-pointer"
              />
              <button
                aria-label={t("shell.notifications")}
                className="flex size-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white shadow-none transition hover:bg-white/15 focus:outline-none focus:ring-4 focus:ring-white/10 md:border-zinc-200 md:bg-white md:text-zinc-600 md:shadow-sm md:hover:border-zinc-300 md:hover:bg-white md:hover:text-zinc-950 md:focus:ring-zinc-950/5"
                title={t("shell.notifications")}
                type="button"
              >
                <Bell size={15} />
              </button>
            </>
          )}
        </div>
      </div>

      {SHOW_DASHBOARD_SEARCH_COMMAND && (
        <div className="border-t border-white/10 px-5 py-3 md:hidden">
          <label className="relative block">
            <span className="sr-only">{t("shell.globalSearch")}</span>
            <input
              className="h-10 w-full rounded-xl border border-white/15 bg-white/10 px-4 text-[13px] font-normal text-white outline-none placeholder:text-zinc-500 focus:border-white/40 focus:bg-white/15 focus:ring-4 focus:ring-white/10"
              onChange={(event) => setGlobalQuery(event.target.value)}
              placeholder={t("shell.searchDashboard")}
              ref={searchRef}
              type="search"
              value={globalQuery}
            />
          </label>
        </div>
      )}
    </header>
  );
}

export function AppBrandMark({ size }: { size: "md" | "lg" }) {
  const t = useTranslations("dashboard");
  const dimension = size === "lg" ? "size-10" : "size-9";
  return (
    <span
      aria-label={t("shell.brandLogo")}
      className={cx("flex shrink-0 items-center justify-center rounded-xl bg-zinc-950 text-white shadow-sm font-semibold", dimension)}
      role="img"
    >
      <span className="text-[15px] font-semibold tracking-tight">N</span>
    </span>
  );
}

export function StoreIdentityMark({
  logoUrl,
  name,
  size
}: {
  logoUrl: string | null;
  name: string;
  size: "sm" | "md" | "lg";
}) {
  const t = useTranslations("dashboard");
  const dimension = size === "lg" ? "size-10" : size === "md" ? "size-9" : "size-8";
  const iconSize = size === "lg" ? 18 : size === "md" ? 16 : 13;
  const labelName = name.trim() || t("shell.storeFallbackName");

  if (logoUrl) {
    return (
      <span
        aria-label={t("shell.storeLogo", { name: labelName })}
        className={cx("flex shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white bg-contain bg-center bg-no-repeat shadow-sm", dimension)}
        role="img"
        style={{ backgroundImage: `url("${logoUrl.replace(/"/g, '\\"')}")` }}
      />
    );
  }

  return (
    <span className={cx("flex shrink-0 items-center justify-center rounded-xl bg-zinc-950 text-white shadow-sm", dimension)}>
      {size === "sm" ? (
        <span className="text-[10px] font-semibold">{initials(labelName) || "S"}</span>
      ) : (
        <Store size={iconSize} />
      )}
    </span>
  );
}

function MerchantProfileControl({
  collapsed = false,
  merchant,
  merchantError,
  merchantStatus,
  onRetryMerchant
}: {
  collapsed?: boolean;
  merchant: MerchantChrome;
  merchantError?: string;
  merchantStatus: MerchantChromeStatus;
  onRetryMerchant?: () => void;
}) {
  const t = useTranslations("dashboard");
  const ready = merchantStatus === "ready" && Boolean(merchant.storeId);
  const loading = merchantStatus === "idle" || merchantStatus === "loading";
  const error = merchantStatus === "error";
  const primary = ready
    ? merchant.userName || merchant.userEmail || t("shell.merchantProfile")
    : loading
      ? t("shell.profileLoading")
      : t("shell.profileUnavailable");
  const secondary = ready
    ? merchant.storeName || t("shell.storeFallbackName")
    : loading
      ? t("shell.profileLoadingDetail")
      : merchantError || t("shell.profileLoadFailedDescription");
  const title = [primary, ready ? merchant.roleName || secondary : secondary].filter(Boolean).join(" - ");
  const retryable = error && Boolean(onRetryMerchant);

  return (
    <button
      aria-busy={loading}
      aria-label={retryable ? t("shell.retryProfileLoad") : t("shell.merchantProfile")}
      className={cx(
        "flex h-14 w-full items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 text-left shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-zinc-950/5 disabled:cursor-wait disabled:hover:border-zinc-200 disabled:hover:bg-white",
        collapsed && "justify-center px-0",
        error && "border-amber-200 bg-amber-50/60 hover:border-amber-300 hover:bg-amber-50"
      )}
      disabled={loading}
      onClick={retryable ? onRetryMerchant : undefined}
      title={title}
      type="button"
    >
      {loading ? (
        <span className="flex size-8 shrink-0 animate-pulse rounded-xl bg-zinc-200" />
      ) : (
        <StoreIdentityMark
          logoUrl={ready ? merchant.storeLogoUrl : null}
          name={ready ? merchant.storeName : t("shell.storeFallbackName")}
          size="sm"
        />
      )}
      {!collapsed && (
        <span aria-live="polite" className="min-w-0 flex-1">
          <span className={cx("block truncate text-[13px] font-bold", error ? "text-amber-950" : "text-zinc-950")}>
            {primary}
          </span>
          <span className={cx("block truncate text-[11px] font-normal", error ? "text-amber-700" : "text-zinc-500")}>
            {secondary}
          </span>
        </span>
      )}
    </button>
  );
}

export function Sidebar({
  activeNav,
  collapsed,
  loggingOut,
  merchant,
  merchantError,
  merchantStatus,
  navigate,
  onLogout,
  onRetryMerchant,
  setCollapsed
}: {
  activeNav: NavId;
  collapsed: boolean;
  loggingOut: boolean;
  merchant: MerchantChrome;
  merchantError?: string;
  merchantStatus: MerchantChromeStatus;
  navigate: (id: NavId) => void;
  onLogout: () => void;
  onRetryMerchant: () => void;
  setCollapsed: (value: boolean) => void;
}) {
  const t = useTranslations("dashboard");

  return (
    <aside
      className={cx(
        "fixed inset-y-0 left-0 z-40 hidden h-[100dvh] border-r border-zinc-200/80 bg-white transition-[width] duration-200 ease-out lg:flex lg:flex-col",
        collapsed ? "w-20" : "w-[272px]"
      )}
    >
      <div className={cx("flex h-[80px] items-center border-b border-zinc-100", collapsed ? "justify-center px-2" : "gap-3 px-5")}>
        {!collapsed && <AppBrandMark size="lg" />}
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold tracking-tight text-zinc-950">{t("shell.brand")}</p>
          </div>
        )}
        <button
          aria-label={collapsed ? t("shell.expandSidebar") : t("shell.collapseSidebar")}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 shadow-sm transition hover:border-zinc-300 hover:text-zinc-950 focus:outline-none focus:ring-4 focus:ring-zinc-950/5"
          onClick={() => setCollapsed(!collapsed)}
          type="button"
        >
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-4" aria-label={t("shell.merchantNavigation")}>
        {navItems.map((item) => (
          <NavButton active={activeNav === item.id} collapsed={collapsed} key={item.id} item={item} onClick={() => navigate(item.id)} />
        ))}
        <button
          aria-label={t("shell.help")}
          className={cx(
            "group relative flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[13px] font-bold text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-950 focus:outline-none focus:ring-4 focus:ring-zinc-950/5",
            collapsed && "justify-center px-0"
          )}
          title={collapsed ? t("shell.help") : undefined}
          type="button"
        >
          <CircleHelp size={16} />
          {!collapsed && <span className="min-w-0 flex-1 text-left">{t("shell.help")}</span>}
        </button>
        <button
          aria-label={t("shell.logout")}
          className={cx(
            "group relative flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[13px] font-bold text-red-600 transition hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-4 focus:ring-red-500/10 disabled:cursor-not-allowed disabled:opacity-60",
            collapsed && "justify-center px-0"
          )}
          disabled={loggingOut}
          onClick={onLogout}
          title={collapsed ? t("shell.logout") : undefined}
          type="button"
        >
          <LogOut size={16} />
          {!collapsed && <span className="min-w-0 flex-1 text-left">{loggingOut ? t("shell.loggingOut") : t("shell.logout")}</span>}
        </button>
      </nav>

      <div className="border-t border-zinc-100 p-4">
        <MerchantProfileControl
          collapsed={collapsed}
          merchant={merchant}
          merchantError={merchantError}
          merchantStatus={merchantStatus}
          onRetryMerchant={onRetryMerchant}
        />
      </div>
    </aside>
  );
}

export function NavButton({
  active,
  collapsed,
  item,
  onClick
}: {
  active: boolean;
  collapsed: boolean;
  item: (typeof navItems)[number];
  onClick: () => void;
}) {
  const t = useTranslations("dashboard");
  const Icon = item.icon;
  const label = t(item.labelKey as never);
  return (
    <button
      className={cx(
        "group relative flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[13px] font-bold transition focus:outline-none focus:ring-4 focus:ring-zinc-950/5",
        active ? "bg-zinc-100 text-zinc-900" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950",
        collapsed && "justify-center px-0"
      )}
      onClick={onClick}
      title={collapsed ? label : undefined}
      type="button"
    >
      {active && !collapsed && <span className="absolute -left-4 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-zinc-950" />}
      <Icon size={16} />
      {!collapsed && <span className="min-w-0 flex-1 text-left">{label}</span>}
    </button>
  );
}

export function MobileDrawer({
  activeNav,
  loggingOut,
  merchant,
  merchantError,
  merchantStatus,
  navigate,
  onClose,
  onLogout,
  onRetryMerchant
}: {
  activeNav: NavId;
  loggingOut: boolean;
  merchant: MerchantChrome;
  merchantError?: string;
  merchantStatus: MerchantChromeStatus;
  navigate: (id: NavId) => void;
  onClose: () => void;
  onLogout: () => void;
  onRetryMerchant: () => void;
}) {
  const t = useTranslations("dashboard");

  return (
    <div className="fixed inset-0 z-50 overflow-hidden overscroll-contain bg-zinc-950/40 backdrop-blur-sm lg:hidden">
      <button
        aria-label={t("shell.closeNavigationBackdrop")}
        className="fixed inset-0 cursor-default touch-none"
        onClick={onClose}
        onTouchMove={(event) => event.preventDefault()}
        type="button"
      />
      <aside
        aria-label={t("shell.mobileMenu")}
        className="fixed left-0 top-0 z-10 flex h-[100dvh] max-h-[100dvh] w-[min(84vw,22rem)] flex-col overflow-hidden overscroll-contain rounded-r-2xl border-r border-zinc-200 bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between px-5 pb-4 pt-5">
          <div className="flex items-center gap-3">
            <AppBrandMark size="md" />
            <div>
              <p className="text-sm font-semibold tracking-tight text-zinc-950">{t("shell.brand")}</p>
              <p className="text-[11px] font-normal text-zinc-500">{t("shell.workspace")}</p>
            </div>
          </div>
          <button
            aria-label={t("shell.closeNavigationPanel")}
            className="flex size-9 items-center justify-center rounded-xl border border-zinc-200 text-zinc-500"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-4 py-2" aria-label={t("shell.mobileNavigationDrawer")}>
          {navItems.map((item) => (
            <NavButton active={activeNav === item.id} collapsed={false} item={item} key={item.id} onClick={() => navigate(item.id)} />
          ))}
          <button
            aria-label={t("shell.help")}
            className="group relative flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[13px] font-bold text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-950 focus:outline-none focus:ring-4 focus:ring-zinc-950/5"
            type="button"
          >
            <CircleHelp size={16} />
            <span className="min-w-0 flex-1 text-left">{t("shell.help")}</span>
          </button>
          <button
            aria-label={t("shell.logout")}
            className="group relative flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[13px] font-bold text-red-600 transition hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-4 focus:ring-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loggingOut}
            onClick={onLogout}
            type="button"
          >
            <LogOut size={16} />
            <span className="min-w-0 flex-1 text-left">{loggingOut ? t("shell.loggingOut") : t("shell.logout")}</span>
          </button>
        </nav>
        <div
          className="shrink-0 border-t border-zinc-100 p-4"
          style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
        >
          <MerchantProfileControl
            merchant={merchant}
            merchantError={merchantError}
            merchantStatus={merchantStatus}
            onRetryMerchant={onRetryMerchant}
          />
        </div>
      </aside>
    </div>
  );
}

export function MobileBottomNav({ activeNav, navigate }: { activeNav: NavId; navigate: (id: NavId) => void }) {
  const t = useTranslations("dashboard");
  const mobileItems = navItems.filter((item) => ["dashboard", "products", "orders", "analytics", "settings"].includes(item.id));
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200/70 bg-white/95 px-2 pt-2 shadow-[0_-12px_32px_rgba(24,24,27,0.08)] backdrop-blur-md lg:hidden"
      style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
      aria-label={t("shell.mobileNavigation")}
    >
      <div className="mx-auto grid w-full max-w-md grid-cols-5 items-stretch gap-1">
        {mobileItems.map((item) => {
          const Icon = item.icon;
          const active = activeNav === item.id;
          const label = t(item.labelKey as never);
          return (
            <button
              aria-current={active ? "page" : undefined}
              aria-label={label}
              className={cx(
                "group relative flex h-14 min-w-0 flex-col items-center justify-center rounded-xl px-1 text-center transition focus:outline-none focus:ring-4 focus:ring-zinc-950/5",
                active ? "bg-zinc-100 text-zinc-950" : "text-zinc-400 hover:bg-zinc-50 hover:text-zinc-700"
              )}
              key={item.id}
              onClick={() => navigate(item.id)}
              type="button"
            >
              <span className={cx("flex size-6 shrink-0 items-center justify-center rounded-lg transition-transform duration-200", active && "scale-105")}>
                <Icon size={17} />
              </span>
              <span className={cx("mt-1 block max-w-full truncate text-[9px] font-medium leading-none tracking-normal transition-colors duration-200", active && "font-semibold")}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
