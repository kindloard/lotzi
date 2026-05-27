"use client";

import { useCallback, useEffect, useMemo } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { merchantRoutes, navFromMerchantPath, routeForNav } from "../config/navigation";
import type { NavId } from "../types/dashboard";

export function useMerchantNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const activeNav = useMemo<NavId>(() => navFromMerchantPath(pathname) ?? "dashboard", [pathname]);

  const navigate = useCallback(
    (nav: NavId) => {
      const route = routeForNav(nav);
      if (route && activeNav !== nav) {
        router.push(route);
      }
    },
    [activeNav, router]
  );

  useEffect(() => {
    Object.values(merchantRoutes).forEach((route) => router.prefetch(route));
  }, [router]);

  return { activeNav, navigate };
}
