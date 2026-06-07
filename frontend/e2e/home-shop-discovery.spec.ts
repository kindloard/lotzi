import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const agasthyarpatti = {
  latitude: 8.7127673,
  longitude: 77.4218043
};

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(agasthyarpatti);
});

test("keeps the landing SSR shop fetch wired to the approved shops API", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/features/shops/api/server-shops.ts"),
    "utf8"
  );
  expect(source).toContain('serverFetchJson<Shop[]>("/v1/shops"');
});

test("keeps fallback shop data off the home render path until location is enabled", () => {
  const pageSource = readFileSync(
    resolve(process.cwd(), "src/app/[locale]/page.tsx"),
    "utf8"
  );
  const browserSource = readFileSync(
    resolve(process.cwd(), "src/features/shops/components/landing-shop-browser.tsx"),
    "utf8"
  );
  const gridSource = readFileSync(
    resolve(process.cwd(), "src/features/shops/components/nearby-shops-grid.tsx"),
    "utf8"
  );

  expect(pageSource).not.toContain("getShopsForLanding");
  expect(pageSource).not.toContain("getDealProductsForLanding");
  expect(browserSource).toContain("const shops = coordinates ? nearbyShops : []");
  expect(gridSource).toContain("const shouldRenderShopResults = !locationNeedsAction");
});

test("keeps returning-user nearby SSR behind geo cookie and dehydration flags", () => {
  const pageSource = readFileSync(
    resolve(process.cwd(), "src/app/[locale]/page.tsx"),
    "utf8"
  );
  const serverSource = readFileSync(
    resolve(process.cwd(), "src/features/shops/api/server-shops.ts"),
    "utf8"
  );
  const browserSource = readFileSync(
    resolve(process.cwd(), "src/features/shops/components/landing-shop-browser.tsx"),
    "utf8"
  );
  const nearbyHookSource = readFileSync(
    resolve(process.cwd(), "src/features/shops/hooks/use-nearby-shops.ts"),
    "utf8"
  );

  expect(pageSource).toContain("GEO_GRID_COOKIE_NAME");
  expect(pageSource).toContain("getNearbyShopsForLandingGeoCookie");
  expect(serverSource).toContain('booleanFromEnv("HOME_GEO_SSR_ENABLED", false)');
  expect(serverSource).toContain('booleanFromEnv("HOME_NEARBY_DEHYDRATION_ENABLED", false)');
  expect(serverSource).toContain("serverFetchJson<NearbyShopsResponse | null>");
  expect(serverSource).toContain("/v1/shops/nearby/cell?");
  expect(browserSource).toContain("initialNearby?.coordinates");
  expect(nearbyHookSource).toContain("refetchOnMount: hasFreshInitialNearby ? false : true");
  expect(nearbyHookSource).toContain("writeGeoGridCookie(grid, effectiveRadiusKm)");
});

test("does not show shop cards before browser location is enabled", async ({ context, page }) => {
  await context.clearPermissions();
  await mockNearbyShops(page, () => [shopFixture({ distanceMeters: 34 })]);

  await page.goto("/en");

  await expect(page.getByRole("button", { name: /enable location/i })).toBeVisible();
  await expect(page.getByText("Auxi store")).not.toBeVisible();
  await expect(page.getByText("No Shops Found")).not.toBeVisible();
  await expect(page.locator("[data-display-state]")).toHaveCount(0);
});

test("expands the nearby radius before showing the empty shop state", async ({ page }) => {
  const radii: string[] = [];
  await mockNearbyShops(page, ({ radiusKm }) => {
    radii.push(radiusKm);
    return radiusKm === "5" ? [] : [shopFixture({ distanceMeters: 1200 })];
  });

  await page.goto("/en");

  await expect(page.getByText("Auxi store")).toBeVisible();
  await expect(page.getByText("No Shops Found")).not.toBeVisible();
  expect(radii).toContain("5");
  expect(radii).toContain("10");
});

test("ignores stale empty session cache entries when empty caching is disabled", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "ns:shops:nearby:v2:8.713:77.422:5:24:first",
      JSON.stringify({
        cachedAt: Date.now(),
        data: {
          apiVersion: "v1",
          radiusKm: 5,
          items: [],
          pageInfo: { limit: 24, hasNextPage: false, nextCursor: null }
        }
      })
    );
  });
  await mockNearbyShops(page, () => [shopFixture({ distanceMeters: 34 })]);

  await page.goto("/en");

  await expect(page.getByText("Auxi store")).toBeVisible();
  const cachedItemCount = await page.evaluate(() => {
    const raw = sessionStorage.getItem("ns:shops:nearby:v2:8.713:77.422:5:24:first");
    if (!raw) {
      return 0;
    }
    return JSON.parse(raw).data.items.length as number;
  });
  expect(cachedItemCount).toBeGreaterThan(0);
});

async function mockNearbyShops(
  page: import("@playwright/test").Page,
  itemsForRequest: (input: { radiusKm: string }) => Array<Record<string, unknown>>
) {
  await page.context().route("**/*", async (route) => {
    if (!route.request().url().includes("nearby/cell")) {
      await route.continue();
      return;
    }
    const url = new URL(route.request().url());
    const radiusKm = url.searchParams.get("radiusKm") ?? "5";
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        apiVersion: "v1",
        radiusKm: Number(radiusKm),
        items: itemsForRequest({ radiusKm }),
        pageInfo: { limit: 24, hasNextPage: false, nextCursor: null },
        cache: {
          ageMs: 0,
          grid: {
            latGrid: url.searchParams.get("latGrid") ?? "8.713",
            lngGrid: url.searchParams.get("lngGrid") ?? "77.422"
          },
          source: "miss"
        }
      })
    });
  });
}

function shopFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "5537fb23-d009-454f-9d85-444c26195e86",
    name: "Auxi store",
    slug: "auxi-store",
    publicId: "871480",
    publicSlug: "auxi-store",
    distance: "Nearby",
    rating: "4.5",
    reviews: "250 reviews",
    type: "grocery",
    typeName: "Grocery",
    deliveryTime: "Self Pickup",
    deliveryFee: "No delivery",
    imageBg: "from-emerald-500 to-teal-600",
    initials: "AS",
    featuredProduct: "palm oil",
    tags: ["Supermarket", "Organic", "Same-day"],
    imageUrl: null,
    logoUrl: null,
    bannerUrl: null,
    latitude: agasthyarpatti.latitude,
    longitude: agasthyarpatti.longitude,
    distanceMeters: 34,
    distanceAccuracyMeters: null,
    distanceSource: "straight_line",
    durationSeconds: null,
    durationText: null,
    branding: {
      tagline: "best shop for grocery",
      description: "Modern grocery store",
      primaryColor: "#0f766e",
      accentColor: "#f59e0b"
    },
    ...overrides
  };
}
