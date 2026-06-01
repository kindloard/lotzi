"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resolveApiBaseUrl } from "@/lib/api-base";
import { shopQueryKeys } from "../query-keys";
import type { ShopProductDetailResponse, ShopProductsResponse } from "../shops-api";

interface CatalogRealtimeEvent {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: string;
  storePublicId?: string | null;
  productPublicId?: string | null;
  changedFields?: string[];
  snapshot?: {
    price?: number;
    compareAtPrice?: number | null;
    stockStatus?: "IN_STOCK" | "OUT_OF_STOCK";
    isAvailable?: boolean;
    catalogVersion?: number;
    productVariantId?: string;
  };
}

interface CatalogRealtimeMessage {
  type: string;
  event?: CatalogRealtimeEvent;
}

export function useCatalogRealtimeSubscription(input: {
  storePublicId: string;
  productPublicIds?: string[];
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const debounceRef = useRef<number | undefined>(undefined);
  const productPublicIdsKey = (input.productPublicIds ?? []).join("|");
  const productPublicIds = useMemo(
    () => Array.from(new Set(input.productPublicIds ?? [])).filter(Boolean).sort(),
    [productPublicIdsKey]
  );

  useEffect(() => {
    if (!input.enabled || typeof window === "undefined") {
      return;
    }
    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let reconnectAttempt = 0;

    const connect = () => {
      socket = new WebSocket(catalogWebSocketUrl());
      socket.addEventListener("open", () => {
        reconnectAttempt = 0;
        socket?.send(JSON.stringify({
          type: "subscribe",
          stores: [input.storePublicId],
          products: productPublicIds
        }));
      });
      socket.addEventListener("message", (message) => {
        const event = parseCatalogEvent(message.data);
        if (!event) {
          return;
        }
        patchVisibleCatalogData(queryClient, event);
        window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: shopQueryKeys.catalogRoot() });
          void queryClient.invalidateQueries({ queryKey: shopQueryKeys.pdpRoot() });
          void queryClient.invalidateQueries({ queryKey: shopQueryKeys.deals() });
          void queryClient.invalidateQueries({ queryKey: shopQueryKeys.list() });
          void queryClient.invalidateQueries({ queryKey: ["cart", "validation"] });
        }, 250 + Math.floor(Math.random() * 500));
      });
      socket.addEventListener("close", () => {
        if (closed) {
          return;
        }
        reconnectAttempt += 1;
        const delay = Math.min(10_000, 500 * 2 ** reconnectAttempt);
        reconnectTimer = window.setTimeout(connect, delay);
      });
    };

    connect();

    return () => {
      closed = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(debounceRef.current);
      socket?.close();
    };
  }, [input.enabled, input.storePublicId, productPublicIds, queryClient]);
}

function patchVisibleCatalogData(
  queryClient: ReturnType<typeof useQueryClient>,
  event: CatalogRealtimeEvent
) {
  const productPublicId = event.productPublicId;
  const snapshot = event.snapshot;
  if (!productPublicId || !snapshot) {
    return;
  }
  queryClient.setQueriesData<ShopProductsResponse>({ queryKey: shopQueryKeys.catalogRoot() }, (current) => {
    if (!current) {
      return current;
    }
    return {
      ...current,
      products: current.products.map((product) =>
        product.publicId === productPublicId ? patchProduct(product, snapshot) : product
      )
    };
  });
  queryClient.setQueriesData<ShopProductDetailResponse>({ queryKey: shopQueryKeys.pdpRoot() }, (current) => {
    if (!current || current.product.publicId !== productPublicId) {
      return current;
    }
    return {
      ...current,
      product: patchProduct(current.product, snapshot)
    };
  });
}

function patchProduct<T extends ShopProductsResponse["products"][number]>(
  product: T,
  snapshot: NonNullable<CatalogRealtimeEvent["snapshot"]>
): T {
  const nextPrice = typeof snapshot.price === "number" ? snapshot.price : product.price;
  const nextCompareAtPrice = snapshot.compareAtPrice !== undefined ? snapshot.compareAtPrice : product.compareAtPrice;
  const nextInStock = snapshot.isAvailable !== undefined
    ? snapshot.isAvailable
    : snapshot.stockStatus
      ? snapshot.stockStatus === "IN_STOCK"
      : product.inStock;
  return {
    ...product,
    compareAtPrice: nextCompareAtPrice,
    inStock: nextInStock,
    price: nextPrice,
    variants: product.variants.map((variant) => {
      if (snapshot.productVariantId && variant.id !== snapshot.productVariantId) {
        return variant;
      }
      return {
        ...variant,
        compareAtPrice: nextCompareAtPrice,
        inStock: nextInStock,
        price: nextPrice
      };
    })
  };
}

function parseCatalogEvent(data: unknown): CatalogRealtimeEvent | null {
  if (typeof data !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(data) as CatalogRealtimeMessage;
    return parsed.type === "catalog.product.changed.v1" && parsed.event ? parsed.event : null;
  } catch {
    return null;
  }
}

function catalogWebSocketUrl() {
  const configured = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "") + "/api/v1/realtime/catalog";
  }
  const apiBase = resolveApiBaseUrl();
  if (apiBase.startsWith("http://") || apiBase.startsWith("https://")) {
    const url = new URL(apiBase);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/api/v1/realtime/catalog";
    url.search = "";
    return url.toString();
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/v1/realtime/catalog`;
}
