import { createHash } from "node:crypto";

export function publicStoreCode(storeId: string) {
  const hash = createHash("sha256").update(storeId).digest("hex");
  const numeric = BigInt(`0x${hash.slice(0, 12)}`) % 1_000_000n;
  return numeric.toString().padStart(6, "0");
}

export function publicStoreSlug(storeName: string) {
  const normalized = storeName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || "store";
}

export function publicProductCode(productId: string) {
  return productId.replace(/-/g, "").toLowerCase();
}

export function publicProductSlug(productName: string) {
  const normalized = productName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || "product";
}
