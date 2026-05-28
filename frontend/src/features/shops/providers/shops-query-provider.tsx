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
        gcTime: 30 * 60 * 1000,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: 2,
        staleTime: 5 * 60 * 1000
      },
      mutations: {
        retry: false
      }
    }
  });
}
