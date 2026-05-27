"use client";

import { AlertTriangle, ArrowRight, RefreshCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "@/i18n/navigation";
import { useAuthSession } from "@/components/session-refresh-provider";
import { logout } from "@/lib/auth-api";
import { navItems } from "../config/navigation";
import { cx } from "../lib/dashboard-utils";
import { productToDraft } from "../lib/product-draft";
import type { NavId } from "../types/dashboard";
import { DashboardHeader, MobileBottomNav, MobileDrawer, Sidebar } from "../components/chrome/dashboard-chrome";
import { DashboardSkeleton } from "../components/feedback/dashboard-skeleton";
import { CommandPalette } from "../components/overlays/command-palette";
import { OrderDrawer } from "../components/overlays/order-drawer";
import { ProductCreateDrawer } from "../components/product-create/product-create-drawer";
import { ConfirmDialog, EmptyState } from "../components/ui/dashboard-ui";
import styles from "../styles/merchant-dashboard-layout.module.css";
import { MerchantIdentityProvider, useMerchantIdentity } from "./merchant-identity-provider";
import { useMerchantNavigation } from "./merchant-navigation";
import { MerchantOrdersProvider, useMerchantOrders } from "./merchant-orders-provider";
import { MerchantProductUiProvider, useMerchantProductUi } from "./merchant-product-ui-provider";
import { MerchantQueryProvider } from "./merchant-query-provider";
import { MerchantShellUiProvider, useMerchantShellUi } from "./merchant-shell-ui-provider";

export function MerchantDashboardShell({ children }: { children: ReactNode }) {
  return (
    <MerchantQueryProvider>
      <MerchantIdentityProvider>
        <MerchantShellUiProvider>
          <MerchantOrdersProvider>
            <MerchantProductUiProvider>
              <MerchantDashboardShellFrame>{children}</MerchantDashboardShellFrame>
            </MerchantProductUiProvider>
          </MerchantOrdersProvider>
        </MerchantShellUiProvider>
      </MerchantIdentityProvider>
    </MerchantQueryProvider>
  );
}

function MerchantDashboardShellFrame({ children }: { children: ReactNode }) {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const { clearSession } = useAuthSession();
  const identity = useMerchantIdentity();
  const navigation = useMerchantNavigation();
  const shell = useMerchantShellUi();
  const orders = useMerchantOrders();
  const productUi = useMerchantProductUi();
  const loggingOutRef = useRef(false);

  const navigate = useCallback(
    (nav: NavId) => {
      shell.setMobileNavOpen(false);
      navigation.navigate(nav);
    },
    [navigation, shell]
  );

  const handleLogout = useCallback(async () => {
    if (loggingOutRef.current) {
      return;
    }
    loggingOutRef.current = true;
    shell.setLoggingOut(true);
    shell.setMobileNavOpen(false);
    clearSession();
    try {
      await logout();
    } catch {
      // Local session is already cleared; redirect remains the source of truth.
    } finally {
      router.replace("/auth/login");
    }
  }, [clearSession, router, shell]);

  useEffect(() => {
    if (!shell.mobileNavOpen) {
      return;
    }

    const scrollY = window.scrollY;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyLeft = document.body.style.left;
    const previousBodyRight = document.body.style.right;
    const previousBodyWidth = document.body.style.width;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscrollBehavior = document.body.style.overscrollBehavior;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousHtmlOverscrollBehavior = document.documentElement.style.overscrollBehavior;

    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.documentElement.style.overscrollBehavior = previousHtmlOverscrollBehavior;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.left = previousBodyLeft;
      document.body.style.right = previousBodyRight;
      document.body.style.width = previousBodyWidth;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscrollBehavior;
      window.scrollTo(0, scrollY);
    };
  }, [shell.mobileNavOpen]);

  useEffect(() => {
    let pendingGo = false;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        shell.setCommandOpen(true);
        return;
      }

      if (event.key === "Escape") {
        shell.setCommandOpen(false);
        shell.setMobileNavOpen(false);
        orders.closeOrder();
        return;
      }

      if (typing) {
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        shell.searchRef.current?.focus();
        return;
      }

      if (event.key.toLowerCase() === "n" && identity.isReady) {
        event.preventDefault();
        navigate("products");
        productUi.openProductCreate();
        return;
      }

      if (event.key.toLowerCase() === "g") {
        pendingGo = true;
        window.setTimeout(() => {
          pendingGo = false;
        }, 900);
        return;
      }

      if (pendingGo) {
        const key = event.key.toLowerCase();
        const match = navItems.find((item) => item.shortcut.toLowerCase().endsWith(key));
        if (match) {
          event.preventDefault();
          navigate(match.id);
          pendingGo = false;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [identity.isReady, navigate, orders, productUi, shell]);

  const content = identity.isBootstrapping || identity.status === "idle" || identity.status === "loading"
    ? <DashboardSkeleton />
    : identity.status === "error"
      ? <MerchantIdentityError />
      : children;

  return (
    <main className={styles.root}>
      <div className={styles.shell}>
        <Sidebar
          activeNav={navigation.activeNav}
          collapsed={shell.sidebarCollapsed}
          merchant={identity.chrome}
          merchantError={identity.errorMessage ?? undefined}
          merchantStatus={identity.status}
          navigate={navigate}
          onLogout={handleLogout}
          onRetryMerchant={identity.retry}
          loggingOut={shell.loggingOut}
          setCollapsed={shell.setSidebarCollapsed}
        />

        <section className={cx(styles.content, shell.sidebarCollapsed && styles.contentCollapsed)}>
          <DashboardHeader
            activeNav={navigation.activeNav}
            globalQuery={shell.globalQuery}
            onCommand={() => shell.setCommandOpen(true)}
            onMobileMenu={() => shell.setMobileNavOpen(true)}
            searchRef={shell.searchRef}
            setGlobalQuery={shell.setGlobalQuery}
          />

          <div className={styles.contentInner}>{content}</div>
        </section>
      </div>

      <MobileBottomNav activeNav={navigation.activeNav} navigate={navigate} />

      {shell.mobileNavOpen && (
        <MobileDrawer
          activeNav={navigation.activeNav}
          merchant={identity.chrome}
          merchantError={identity.errorMessage ?? undefined}
          merchantStatus={identity.status}
          navigate={navigate}
          onClose={() => shell.setMobileNavOpen(false)}
          onLogout={handleLogout}
          onRetryMerchant={identity.retry}
          loggingOut={shell.loggingOut}
        />
      )}

      {shell.commandOpen && (
        <CommandPalette
          onClose={() => shell.setCommandOpen(false)}
          onNavigate={navigate}
          onNewProduct={() => {
            shell.setCommandOpen(false);
            navigate("products");
            productUi.openProductCreate();
          }}
        />
      )}

      {productUi.productCreateOpen && (
        <ProductCreateDrawer
          initialDraft={productUi.productCreateMode.kind === "edit" ? productToDraft(productUi.productCreateMode.product) : undefined}
          isSaving={productUi.isCreatingProduct}
          key={productUi.productCreateMode.kind === "edit" ? productUi.productCreateMode.product.id : "create"}
          mode={productUi.productCreateMode.kind}
          onClose={productUi.closeProductCreate}
          onSave={productUi.createProduct}
          storeId={identity.storeId}
        />
      )}

      {orders.selectedOrder && (
        <OrderDrawer
          onClose={orders.closeOrder}
          onMarkPacked={(orderId) => orders.markOrdersPacked([orderId])}
          order={orders.selectedOrder}
        />
      )}

      {productUi.confirmProduct && (
        <ConfirmDialog
          body={t("products.archiveDialog.body")}
          confirmLabel={t("products.archiveDialog.confirm")}
          onCancel={productUi.resetArchiveProduct}
          onConfirm={productUi.archiveProduct}
          title={t("products.archiveDialog.title", { name: productUi.confirmProduct.name })}
        />
      )}
    </main>
  );
}

function MerchantIdentityError() {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const identity = useMerchantIdentity();

  return (
    <EmptyState
      actionIcon={identity.isMissingStore ? ArrowRight : RefreshCcw}
      actionLabel={identity.isMissingStore ? t("common.continue") : t("shell.retryProfileLoad")}
      body={identity.errorMessage ?? t("shell.profileLoadFailedDescription")}
      icon={AlertTriangle}
      onAction={identity.isMissingStore ? () => router.push("/merchant/onboarding") : identity.retry}
      title={t("shell.profileUnavailable")}
    />
  );
}
