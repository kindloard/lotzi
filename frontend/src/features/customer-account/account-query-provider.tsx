"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

let browserAccountQueryClient: QueryClient | null = null;

export function AccountQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(getAccountQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function getAccountQueryClient() {
  if (typeof window === "undefined") {
    return createAccountQueryClient();
  }
  browserAccountQueryClient ??= createAccountQueryClient();
  return browserAccountQueryClient;
}

function createAccountQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 30 * 60 * 1000,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 60 * 1000
      },
      mutations: {
        retry: false
      }
    }
  });
}
