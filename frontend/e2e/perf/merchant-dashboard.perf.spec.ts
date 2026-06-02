import { expect, Page, test } from "@playwright/test";

type ApiHandler = (request: {
  body: Record<string, unknown>;
  url: URL;
}) => Promise<{ status?: number; body?: unknown; headers?: Record<string, string> }> | {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

const SESSION_ENVELOPE_KEY = "lotzi:session-envelope:v2";
const appUrl = `http://127.0.0.1:${process.env.PLAYWRIGHT_PERF_PORT ?? "3100"}`;
const merchantSession = {
  accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
  redirectTo: "/merchant/dashboard",
  routeState: {
    merchantStoreId: "store-1",
    merchantStoreStatus: "APPROVED",
    onboardingComplete: true,
    onboardingState: "ACTIVE",
    redirectTo: "/merchant/dashboard"
  },
  sessionId: "session-1",
  user: {
    authzVersion: 1,
    avatarUrl: null,
    email: "owner@example.com",
    emailVerified: true,
    fullName: "Owner",
    id: "user-1",
    roleCodes: ["MERCHANT_OWNER"],
    status: "ACTIVE"
  }
};

test("merchant dashboard route transitions meet network and web-vitals budgets", async ({ page }) => {
  const calls: string[] = [];
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.context().addCookies([
    { name: "lotzi_refresh", value: "refresh-token", url: appUrl },
    { name: "lotzi_csrf", value: "csrf-token", url: appUrl }
  ]);
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: SESSION_ENVELOPE_KEY,
    value: {
      generation: 100,
      session: merchantSession,
      version: 2,
      writtenAt: new Date().toISOString()
    }
  });

  await mockApi(page, {
    "POST /auth/refresh": () => {
      calls.push("refresh");
      return { body: merchantSession };
    },
    "GET /merchant/dashboard/bootstrap": () => {
      calls.push("bootstrap");
      return {
        body: {
          membership: { roleCode: "MERCHANT_OWNER", roleName: "Owner" },
          store: {
            id: "store-1",
            logoUrl: null,
            name: "Fresh Mart",
            slug: "fresh-mart",
            status: "APPROVED"
          },
          user: {
            avatarUrl: null,
            email: "owner@example.com",
            id: "user-1",
            name: "Owner"
          }
        }
      };
    },
    "GET /v1/merchant/products": () => {
      calls.push("products");
      return { body: { apiVersion: "v1", products: [] } };
    }
  });

  await page.goto("/en/merchant/dashboard");
  await expect.poll(() => calls.filter((call) => call === "bootstrap").length).toBe(1);
  await expect.poll(() => calls.filter((call) => call === "products").length).toBe(1);
  await page.waitForLoadState("networkidle");

  await warmMerchantRoutes(page);

  const productsTransition = await timedNavigation(page, "Products", /\/merchant\/products$/);
  const ordersTransition = await timedNavigation(page, "Orders", /\/merchant\/orders$/);
  const analyticsTransition = await timedNavigation(page, "Analytics", /\/merchant\/analytics$/);

  expect(productsTransition).toBeLessThan(150);
  expect(ordersTransition).toBeLessThan(150);
  expect(analyticsTransition).toBeLessThan(150);
  expect(calls.filter((call) => call === "refresh")).toHaveLength(0);
  expect(calls.filter((call) => call === "bootstrap")).toHaveLength(1);
  expect(calls.filter((call) => call === "products")).toHaveLength(1);

  await waitForVital(page, "LCP");
  await waitForVital(page, "CLS");
  await waitForVital(page, "INP");
  const vitals = await page.evaluate(() => window.__LOTZI_WEB_VITALS__ ?? {});
  expect(Math.max(...vitals.LCP)).toBeLessThan(2500);
  expect(Math.max(...vitals.CLS)).toBeLessThan(0.1);
  expect(Math.max(...vitals.INP)).toBeLessThan(200);
});

async function warmMerchantRoutes(page: Page) {
  for (const [label, urlPattern] of [
    ["Products", /\/merchant\/products$/],
    ["Overview", /\/merchant\/dashboard$/],
    ["Orders", /\/merchant\/orders$/],
    ["Overview", /\/merchant\/dashboard$/],
    ["Analytics", /\/merchant\/analytics$/],
    ["Overview", /\/merchant\/dashboard$/]
  ] as const) {
    await page.getByRole("button", { name: new RegExp(`^${label}$`) }).click();
    await expect(page).toHaveURL(urlPattern);
    await page.waitForLoadState("networkidle");
  }
}

async function timedNavigation(page: Page, label: string, urlPattern: RegExp) {
  const start = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: new RegExp(`^${label}$`) }).click();
  await expect(page).toHaveURL(urlPattern);
  return page.evaluate((startedAt) => performance.now() - startedAt, start);
}

async function waitForVital(page: Page, name: "CLS" | "INP" | "LCP") {
  await page.waitForFunction(
    (metricName) => Boolean(window.__LOTZI_WEB_VITALS__?.[metricName]?.length),
    name,
    { timeout: 10_000 }
  );
}

async function mockApi(page: Page, handlers: Record<string, ApiHandler>) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname.replace(/^\/api/, "")}`;
    const handler = handlers[key];
    if (!handler) {
      await route.fulfill({
        body: JSON.stringify({ message: `Unhandled API route ${key}` }),
        contentType: "application/json",
        status: 404
      });
      return;
    }

    const response = await handler({
      body: request.postData() ? (request.postDataJSON() as Record<string, unknown>) : {},
      url
    });
    await route.fulfill({
      body: JSON.stringify(response.body ?? {}),
      contentType: "application/json",
      headers: response.headers,
      status: response.status ?? 200
    });
  });
}
