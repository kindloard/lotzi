import { apiFetch } from "@/lib/api";
import type { CartItem } from "@/lib/cart-context";

export interface CartValidationLine {
  productId: string;
  variantId: string;
  requestedQuantity: number;
  productName: string | null;
  variantName: string | null;
  storeId: string | null;
  storeName: string | null;
  unitPrice: number;
  compareAtPrice: number | null;
  availableStock: number;
  stockStatus: "IN_STOCK" | "OUT_OF_STOCK";
  isAvailable: boolean;
  reason: string | null;
  productVersion: number;
  stockVersion: number;
  imageUrl: string | null;
}

export interface CartValidationResponse {
  apiVersion: "v1";
  validationVersion: string;
  lastSeenCatalogVersion: string | null;
  hasChanges: boolean;
  allAvailable: boolean;
  lines: CartValidationLine[];
}

export function validateCart(items: CartItem[], lastSeenCatalogVersion?: string | null, init?: RequestInit) {
  return apiFetch<CartValidationResponse>("/v1/cart/validate", {
    ...init,
    method: "POST",
    body: JSON.stringify({
      lastSeenCatalogVersion: lastSeenCatalogVersion ?? undefined,
      items: items
        .filter((item) => item.variantId)
        .map((item) => ({
          productId: item.id,
          variantId: item.variantId,
          quantity: item.qty
        }))
    })
  });
}
