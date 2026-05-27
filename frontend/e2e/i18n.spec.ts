import { expect, test } from "@playwright/test";

test.describe("locale routing and Tamil layout", () => {
  test("redirects legacy auth routes to prefixed canonical routes", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/en\/auth\/login/);
  });

  test("switches language instantly and persists the locale cookie", async ({ context, page }) => {
    await page.goto("/en/auth/login");
    await page.getByRole("button", { name: "தமிழ்" }).click();
    await expect(page).toHaveURL(/\/ta\/auth\/login/);
    await expect(page.getByRole("heading", { name: /Namastore-ல் உள்நுழையவும்/ })).toBeVisible();

    const cookies = await context.cookies();
    expect(cookies.find((cookie) => cookie.name === "namastore_locale")?.value).toBe("ta");
  });

  test("Tamil auth screen has no horizontal overflow or clipped fit controls", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ta/auth/login");

    await expect(page.getByRole("button", { name: "உள்நுழை" })).toBeInViewport({ ratio: 0.75 });
    await assertNoOverflow(page);
  });
});

async function assertNoOverflow(page: import("@playwright/test").Page) {
  const rootOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  );
  expect(rootOverflow).toBe(true);

  const fitControls = await page.locator("[data-i18n-fit]").evaluateAll((nodes) =>
    nodes.map((node) => ({
      fitsHeight: node.scrollHeight <= node.clientHeight + 1,
      fitsWidth: node.scrollWidth <= node.clientWidth + 1
    }))
  );
  for (const control of fitControls) {
    expect(control.fitsWidth).toBe(true);
    expect(control.fitsHeight).toBe(true);
  }
}
