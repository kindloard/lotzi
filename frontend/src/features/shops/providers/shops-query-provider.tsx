"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

let browserShopsQueryClient: QueryClient | null = null;

export function ShopsQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(getShopsQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function getShopsQueryClient() {
  if (typeof window === "undefined") {
    return createShopsQueryClient();
  }

  browserShopsQueryClient ??= createShopsQueryClient();
  return browserShopsQueryClient;
}

function createShopsQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 30s default stale time — individual queries override with their own.
        // Nearby uses 120s; don't refetch everything on every focus event.
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
        refetchOnReconnect: true,
        // Nearby shop cards shouldn't flash-reload on Alt+Tab.
        // The individual hook opts back in for its own logic.
        refetchOnWindowFocus: false,
        retry: 2
      },
      mutations: {
        retry: false
      }
    }
  });
}
