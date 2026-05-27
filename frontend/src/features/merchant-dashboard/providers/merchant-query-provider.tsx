"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

let browserMerchantQueryClient: QueryClient | null = null;

export function MerchantQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(getMerchantQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function getMerchantQueryClient() {
  if (typeof window === "undefined") {
    return createMerchantQueryClient();
  }

  browserMerchantQueryClient ??= createMerchantQueryClient();
  return browserMerchantQueryClient;
}

function createMerchantQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 30 * 60 * 1000,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 5 * 60 * 1000
      }
    }
  });
}
