import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "..", "..");

test("shop product SSR is protected by the catalog budget flag", () => {
  const source = readFileSync(resolve(repoRoot, "frontend/src/features/shops/api/server-shops.ts"), "utf8");

  expect(source).toContain("SHOP_CATALOG_SSR_BUDGET_MS");
  expect(source).toContain("SHOP_CATALOG_SSR_BUDGET_ENABLED");
  expect(source).toContain("timeoutMs: shopCatalogSsrBudgetEnabled()");
  expect(source).toContain("shop_catalog_ssr_budget_exceeded");
});

test("failed initial catalog data renders as remote loading instead of local empty mode", () => {
  const source = readFileSync(resolve(repoRoot, "frontend/src/features/shops/components/shop-catalog.tsx"), "utf8");

  expect(source).toContain("!initialFailed && initialProducts.pagination.total <= initialProducts.pagination.limit");
  expect(source).toContain("showCatalogLoading");
  expect(source).toContain("ProductCardSkeleton");
});
