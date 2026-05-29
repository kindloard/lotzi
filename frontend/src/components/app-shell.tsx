"use client";

import { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ImageDragGuard } from "@/components/image-drag-guard";
import { TopNavbar } from "@/components/top-navbar";
import { SessionRefreshProvider } from "@/components/session-refresh-provider";
import { ToastProvider } from "@/components/toast/toast-context";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import { routing } from "@/i18n/routing";
import { CartProvider } from "@/lib/cart-context";

function usesStandaloneShell(pathname: string) {
  const pathWithoutLocale = stripLocalePrefix(pathname);
  return (
    pathWithoutLocale.startsWith("/auth") ||
    pathWithoutLocale.startsWith("/admin") ||
    pathWithoutLocale.startsWith("/account") ||
    pathWithoutLocale.startsWith("/merchant") ||
    pathWithoutLocale === "/login" ||
    pathWithoutLocale === "/signup" ||
    pathWithoutLocale === "/otp"
  );
}

function hidesTopNavbar(pathname: string) {
  const pathWithoutLocale = stripLocalePrefix(pathname);
  return pathWithoutLocale.startsWith("/checkout");
}

function stripLocalePrefix(pathname: string) {
  const [, maybeLocale, ...rest] = pathname.split("/");
  if (routing.locales.includes(maybeLocale as never)) {
    return `/${rest.join("/")}` || "/";
  }
  return pathname;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (usesStandaloneShell(pathname)) {
    return (
      <ToastProvider>
        <SessionRefreshProvider>
          <ImageDragGuard />
          <WebVitalsReporter />
          {children}
        </SessionRefreshProvider>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <SessionRefreshProvider>
        <ImageDragGuard />
        <WebVitalsReporter />
        <CartProvider>
          {hidesTopNavbar(pathname) ? null : <TopNavbar />}
          {children}
        </CartProvider>
      </SessionRefreshProvider>
    </ToastProvider>
  );
}
