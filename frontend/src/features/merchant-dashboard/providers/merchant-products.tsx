"use client";

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { fetchMerchantProducts } from "@/lib/upload-engine-api";
import { useMerchantIdentity } from "./merchant-identity-provider";
import type { Product } from "../types/dashboard";

export type ProductLoadState = { status: "idle" | "loading" | "ready" | "error"; message?: string };

export function merchantProductsQueryKey(storeId: string) {
  return ["merchant", storeId, "products"] as const;
}

export function useMerchantProducts() {
  const queryClient = useQueryClient();
  const { isReady, storeId } = useMerchantIdentity();

  const query = useQuery({
    enabled: isReady && Boolean(storeId),
    queryKey: merchantProductsQueryKey(storeId),
    queryFn: async () => {
      const payload = await fetchMerchantProducts(storeId);
      return payload.products;
    },
    refetchOnMount: false,
    retry: false
  });

  const products = query.data ?? [];
  const setProducts = useCallback(
    (updater: (current: Product[]) => Product[]) => {
      if (!storeId) {
        return;
      }
      setProductsForStore(queryClient, storeId, updater);
    },
    [queryClient, storeId]
  );

  const retryProducts = useCallback(() => {
    if (!storeId) {
      return;
    }
    void queryClient.invalidateQueries({ queryKey: merchantProductsQueryKey(storeId) });
  }, [queryClient, storeId]);

  const loadState = useMemo<ProductLoadState>(() => {
    if (!isReady || !storeId) {
      return { status: "idle" };
    }
    if (query.isLoading) {
      return { status: "loading" };
    }
    if (query.isError) {
      return { status: "error", message: productErrorMessage(query.error) };
    }
    return { status: "ready" };
  }, [isReady, query.error, query.isError, query.isLoading, storeId]);

  return {
    loadState,
    products,
    retryProducts,
    setProducts,
    status: loadState.status
  };
}

export function setProductsForStore(
  queryClient: QueryClient,
  storeId: string,
  updater: (current: Product[]) => Product[]
) {
  queryClient.setQueryData<Product[]>(merchantProductsQueryKey(storeId), (current) => updater(current ?? []));
}

function productErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.message.trim()) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return undefined;
}
