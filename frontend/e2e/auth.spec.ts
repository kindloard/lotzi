import { expect, Page, test } from "@playwright/test";

type ApiHandler = (request: {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  url: URL;
}) => Promise<{ status?: number; body?: unknown; headers?: Record<string, string> }> | {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

const customerSession = session(["CUSTOMER"]);
const merchantSession = session(["MERCHANT_OWNER"]);
const SESSION_ENVELOPE_KEY = "namastore:session-envelope:v2";

test.beforeEach(async ({ page }) => {
  await page.context().clearCookies();
});

test("protected merchant route redirects to login with next", async ({ page }) => {
  await page.goto("/merchant/onboarding");

  await expect(page).toHaveURL(/\/auth\/login\?next=%2Fmerchant%2Fonboarding/);
});

test("protected account route redirects to login with section-safe next", async ({ page }) => {
  await page.goto("/en/account/orders");

  await expect(page).toHaveURL(/\/auth\/login\?next=%2Faccount%2Forders/);
});

test("navbar My Profile opens the protected account dashboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.context().addCookies([
    { name: "namastore_refresh", value: "refresh-token", url: "http://127.0.0.1:3000" },
    { name: "namastore_csrf", value: "csrf-token", url: "http://127.0.0.1:3000" }
  ]);
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: SESSION_ENVELOPE_KEY,
    value: {
      version: 2,
      generation: 100,
      writtenAt: new Date().toISOString(),
      session: customerSession
    }
  });
  await mockApi(page, {
    "GET /v1/me/bootstrap": () => ({
      body: {
        apiVersion: "v1",
        account: {
          id: "user-1",
          email: "buyer@example.com",
          fullName: "Buyer One",
          avatarUrl: null,
          emailVerified: true,
          profileVersion: "2026-01-02T00:00:00.000Z"
        },
        sections: ["profile", "addresses", "orders", "settings", "security"],
        summary: { addresses: 0, orders: 0, activeSessions: 1, activity: 0 },
        cache: { generatedAt: "2026-01-02T00:00:00.000Z", maxAgeSeconds: 60 }
      }
    }),
    "GET /v1/me/profile": () => ({
      body: {
        apiVersion: "v1",
        profile: accountProfile()
      }
    })
  });

  await page.goto("/en");
  await page.getByRole("button", { name: "Buyer" }).click();
  const profileLink = page.getByRole("link", { name: "My Profile" });
  await expect(profileLink).toBeVisible();
  await profileLink.click();

  await expect(page).toHaveURL(/\/en\/account\/profile$/);
  await expect(page.getByRole("heading", { name: "Buyer One" })).toBeVisible();
});

test("session boot with csrf and no cache refreshes before reading session", async ({ page }) => {
  const calls: string[] = [];
  await page.context().addCookies([
    { name: "namastore_csrf", value: "csrf-token", url: "http://127.0.0.1:3000" }
  ]);
  await mockApi(page, {
    "POST /auth/refresh": () => {
      calls.push("refresh");
      return { body: customerSession };
    },
    "GET /auth/session": () => {
      calls.push("session");
      return { body: customerSession };
    }
  });

  await page.goto("/cart");

  await expect.poll(() => calls[0]).toBe("refresh");
  expect(calls).not.toContain("session");
});

test("session boot uses a cached envelope beyond the skew window without blocking network", async ({ page }) => {
  const calls: string[] = [];
  await page.context().addCookies([
    { name: "namastore_csrf", value: "csrf-token", url: "http://127.0.0.1:3000" }
  ]);
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: SESSION_ENVELOPE_KEY,
    value: {
      version: 2,
      generation: 100,
      writtenAt: new Date().toISOString(),
      session: customerSession
    }
  });
  await mockApi(page, {
    "POST /auth/refresh": () => {
      calls.push("refresh");
      return { body: customerSession };
    },
    "GET /auth/session": () => {
      calls.push("session");
      return { body: customerSession };
    }
  });

  await page.goto("/cart");
  await page.waitForTimeout(500);

  expect(calls).toEqual([]);
});

test("merchant dashboard reuses cached session and preserves chrome across routes", async ({ page }) => {
  const calls: string[] = [];
  const productHeaders: Record<string, string>[] = [];
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.context().addCookies([
    { name: "namastore_refresh", value: "refresh-token", url: "http://127.0.0.1:3000" },
    { name: "namastore_csrf", value: "csrf-token", url: "http://127.0.0.1:3000" }
  ]);
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: SESSION_ENVELOPE_KEY,
    value: {
      version: 2,
      generation: 100,
      writtenAt: new Date().toISOString(),
      session: merchantSession
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
    "GET /v1/merchant/products": ({ headers }) => {
      calls.push("products");
      productHeaders.push(headers);
      return { body: { apiVersion: "v1", products: [] } };
    }
  });

  await page.goto("/en/merchant/dashboard");

  await expect.poll(() => calls.filter((call) => call === "bootstrap").length).toBe(1);
  await expect.poll(() => calls.filter((call) => call === "products").length).toBe(1);
  const initialProductCalls = calls.filter((call) => call === "products").length;
  await expect(page.getByText("Fresh Mart")).toBeVisible();

  await page.getByRole("button", { name: /^Products$/ }).click();
  await expect(page).toHaveURL(/\/merchant\/products$/);
  await expect(page.getByRole("heading", { name: "Products", exact: true })).toBeVisible();

  await page.getByRole("button", { name: /^Orders$/ }).click();
  await expect(page).toHaveURL(/\/merchant\/orders$/);

  await page.getByRole("button", { name: /^Analytics$/ }).click();
  await expect(page).toHaveURL(/\/merchant\/analytics$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/merchant\/orders$/);
  await expect(page.getByText("Fresh Mart")).toBeVisible();

  expect(calls.filter((call) => call === "refresh")).toHaveLength(0);
  expect(calls.filter((call) => call === "bootstrap")).toHaveLength(1);
  expect(calls.filter((call) => call === "products")).toHaveLength(initialProductCalls);
  expect(productHeaders[0]?.["content-type"]).toBeUndefined();
  expect(productHeaders[0]?.["x-store-id"]).toBeUndefined();
});

test("merchant dashboard profile shows a retryable error instead of fallback identity", async ({ page }) => {
  const calls: string[] = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([
    { name: "namastore_refresh", value: "refresh-token", url: "http://127.0.0.1:3000" },
    { name: "namastore_csrf", value: "csrf-token", url: "http://127.0.0.1:3000" }
  ]);
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: SESSION_ENVELOPE_KEY,
    value: {
      version: 2,
      generation: 100,
      writtenAt: new Date().toISOString(),
      session: merchantSession
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
        status: 403,
        body: {
          code: "MERCHANT_STORE_REQUIRED",
          message: "No active merchant store is available for this account."
        }
      };
    },
    "GET /v1/merchant/products": () => {
      calls.push("products");
      return { body: { apiVersion: "v1", products: [] } };
    }
  });

  await page.goto("/en/merchant/products");

  await page.getByRole("button", { name: "Open navigation" }).click();
  const drawer = page.getByLabel("Mobile merchant menu");
  await expect(drawer.getByText("Profile unavailable")).toBeVisible();
  await expect(drawer.getByText("No active merchant store is linked to this account.")).toBeVisible();
  expect(calls.filter((call) => call === "refresh")).toHaveLength(0);
  expect(calls.filter((call) => call === "bootstrap")).toHaveLength(1);
  expect(calls.filter((call) => call === "products")).toHaveLength(0);
});

test("merchant products do not auto-retry identical failed catalog requests", async ({ page }) => {
  const calls: string[] = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addCookies([
    { name: "namastore_refresh", value: "refresh-token", url: "http://127.0.0.1:3000" },
    { name: "namastore_csrf", value: "csrf-token", url: "http://127.0.0.1:3000" }
  ]);
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: SESSION_ENVELOPE_KEY,
    value: {
      version: 2,
      generation: 100,
      writtenAt: new Date().toISOString(),
      session: merchantSession
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
      return {
        status: 500,
        body: { message: "Catalog service is temporarily unavailable." }
      };
    }
  });

  await page.goto("/en/merchant/products");

  await expect(page.getByText("Products could not load")).toBeVisible();
  await page.waitForTimeout(500);
  expect(calls.filter((call) => call === "refresh")).toHaveLength(0);
  expect(calls.filter((call) => call === "bootstrap")).toHaveLength(1);
  expect(calls.filter((call) => call === "products")).toHaveLength(1);
});

test("merchant onboarding stays outside the persistent dashboard shell", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.context().addCookies([
    { name: "namastore_refresh", value: "refresh-token", url: "http://127.0.0.1:3000" },
    { name: "namastore_csrf", value: "csrf-token", url: "http://127.0.0.1:3000" }
  ]);
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: SESSION_ENVELOPE_KEY,
    value: {
      version: 2,
      generation: 100,
      writtenAt: new Date().toISOString(),
      session: merchantSession
    }
  });
  await mockApi(page, {
    "GET /merchant/onboarding": () => ({
      body: {
        data: {
          branding: {},
          business: {},
          legal: {},
          location: {},
          preferences: {}
        },
        drafts: {},
        rules: {
          country: "IN",
          options: {
            businessTypes: [],
            categories: [],
            countries: []
          },
          required: {
            BRANDING: [],
            BUSINESS: [],
            LEGAL: [],
            LOCATION: [],
            PREFERENCES: [],
            REVIEW: []
          }
        },
        state: {
          completionPercent: 0,
          currentStep: "BUSINESS",
          lifecycle: "PENDING",
          version: 1
        },
        store: {
          id: "store-1",
          name: "Fresh Mart",
          slug: "fresh-mart",
          status: "PENDING"
        }
      }
    })
  });

  await page.goto("/en/merchant/onboarding");

  await expect(page).toHaveURL(/\/merchant\/onboarding$/);
  await expect(page.getByLabel("Merchant navigation")).toHaveCount(0);
  await expect(page.getByText("Merchant workspace")).toHaveCount(0);
});

test("merchant dashboard clears stale auth and redirects when refresh recovery fails", async ({ page }) => {
  await page.context().addCookies([
    { name: "namastore_refresh", value: "stale-refresh", url: "http://127.0.0.1:3000" },
    { name: "namastore_csrf", value: "csrf-token", url: "http://127.0.0.1:3000" }
  ]);
  await mockApi(page, {
    "POST /auth/refresh": () => ({
      status: 401,
      body: { code: "AUTH_REFRESH_INVALID", message: "Invalid refresh token." }
    })
  });

  await page.goto("/en/merchant/products");

  await expect(page).toHaveURL(/\/auth\/login/);
});

test("login honors safe next redirects and sends remember=true", async ({ page }) => {
  let loginBody: Record<string, unknown> | null = null;
  await mockApi(page, {
    "POST /auth/login": ({ body }) => {
      loginBody = body;
      return { body: merchantSession };
    }
  });

  await page.goto("/auth/login?next=%2Fcart");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.locator('input[name="password"]').fill("Password1");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(/\/cart$/);
  expect(loginBody).toMatchObject({ remember: true });
});

test("marketplace navbar logout redirects to login after clearing session", async ({ page }) => {
  await page.context().addCookies([
    { name: "namastore_csrf", value: "csrf-token", url: "http://127.0.0.1:3000" }
  ]);
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, {
    key: SESSION_ENVELOPE_KEY,
    value: {
      version: 2,
      generation: 100,
      writtenAt: new Date().toISOString(),
      session: customerSession
    }
  });
  await mockApi(page, {
    "POST /auth/logout": () => ({ body: { status: "OK" } })
  });

  await page.goto("/en");
  await page.getByRole("button", { name: "Buyer" }).click();
  await page.getByRole("button", { name: "Sign Out" }).click();

  await expect(page).toHaveURL(/\/auth\/login$/);
});

test("login server errors do not display invalid-credentials copy", async ({ page }) => {
  await mockApi(page, {
    "POST /auth/login": () => ({
      status: 500,
      body: { code: "INTERNAL_SERVER_ERROR", message: "Internal server error." }
    })
  });

  await page.goto("/auth/login");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.locator('input[name="password"]').fill("Password1");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.getByText("The auth service hit a server error. Check the backend logs, then try again.")).toBeVisible();
  await expect(page.getByText("Email or password is incorrect.")).toHaveCount(0);
});

test("login rejects malicious next values and falls back safely", async ({ page }) => {
  let rejectedRedirect: Record<string, unknown> | null = null;
  await mockApi(page, {
    "POST /auth/redirect/rejected": ({ body }) => {
      rejectedRedirect = body;
      return { body: { status: "RECORDED" } };
    },
    "POST /auth/login": () => ({ body: customerSession })
  });

  await page.goto("/auth/login?next=https%3A%2F%2Fevil.example");
  await expect.poll(() => rejectedRedirect).toMatchObject({
    value: "https://evil.example",
    reason: "absolute-url"
  });

  await page.getByLabel("Email").fill("buyer@example.com");
  await page.locator('input[name="password"]').fill("Password1");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(/\/en$/);
});

test("unchecked remember sends a browser-session login intent", async ({ page }) => {
  let loginBody: Record<string, unknown> | null = null;
  await mockApi(page, {
    "POST /auth/login": ({ body }) => {
      loginBody = body;
      return { body: customerSession };
    }
  });

  await page.goto("/auth/login");
  await page.getByRole("button", { name: "Remember me" }).click();
  await page.getByLabel("Email").fill("buyer@example.com");
  await page.locator('input[name="password"]').fill("Password1");
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(/\/en$/);
  expect(loginBody).toMatchObject({ remember: false });
});

test("signup passes email to OTP and auto-verifies six digits", async ({ page }) => {
  await mockApi(page, {
    "POST /auth/signup": () => ({
      body: { status: "OTP_REQUIRED", email: "buyer@example.com" }
    }),
    "POST /auth/signup/verify": () => ({ body: customerSession })
  });

  await page.goto("/auth/signup");
  await page.getByLabel("Name").fill("Buyer One");
  await page.getByLabel("Email").fill("buyer@example.com");
  await page.locator('input[name="password"]').fill("Password1");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/auth\/otp\?email=buyer%40example\.com/);
  for (const [index, digit] of ["1", "2", "3", "4", "5", "6"].entries()) {
    await page.getByLabel(`Verification code ${index + 1}`).fill(digit);
  }

  await expect(page).toHaveURL(/\/en$/);
});

test("OTP auto-submit does not loop after a failed verification", async ({ page }) => {
  let verifyAttempts = 0;
  await mockApi(page, {
    "POST /auth/signup/verify": () => {
      verifyAttempts += 1;
      return {
        status: 401,
        body: { message: "Invalid OTP" }
      };
    }
  });

  await page.goto("/auth/otp?email=buyer%40example.com");
  for (const [index, digit] of ["1", "2", "3", "4", "5", "6"].entries()) {
    await page.getByLabel(`Verification code ${index + 1}`).fill(digit);
  }

  await expect.poll(() => verifyAttempts, { timeout: 1000 }).toBe(1);
  await page.waitForTimeout(750);
  expect(verifyAttempts).toBe(1);

  await page.getByRole("button", { name: "Verify code" }).click();
  await expect.poll(() => verifyAttempts, { timeout: 1000 }).toBe(2);
});

test("OTP resend shows cooldown copy", async ({ page }) => {
  await mockApi(page, {
    "POST /auth/otp/resend": () => ({
      body: {
        status: "OTP_REQUIRED",
        email: "buyer@example.com",
        cooldownUntil: new Date(Date.now() + 30_000).toISOString()
      }
    })
  });

  await page.goto("/auth/otp?email=buyer%40example.com");
  await page.getByRole("button", { name: "Resend code" }).click();

  await expect(page.getByRole("button", { name: /Resend in/ })).toBeVisible();
});

test("password reset request validates and submits email", async ({ page }) => {
  let resetBody: Record<string, unknown> | null = null;
  await mockApi(page, {
    "POST /auth/password-reset/request": ({ body }) => {
      resetBody = body;
      return { body: { status: "ACCEPTED" } };
    }
  });

  await page.goto("/auth/reset-password");
  await page.getByLabel("Email").fill("buyer@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();

  await expect(page.getByText("If that email exists, reset instructions have been sent.")).toBeVisible();
  expect(resetBody).toMatchObject({ email: "buyer@example.com" });
});

test("password reset consumes hash token and cleans URL", async ({ page }) => {
  let confirmBody: Record<string, unknown> | null = null;
  await mockApi(page, {
    "POST /auth/password-reset/confirm": ({ body }) => {
      confirmBody = body;
      return { body: { status: "PASSWORD_RESET" } };
    }
  });

  await page.goto("/auth/reset-password#token=selector.verifier");
  await expect(page).toHaveURL(/\/auth\/reset-password$/);
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("Password1");
  await page.getByLabel("Confirm password").fill("Password1");
  await page.getByRole("button", { name: "Update password" }).click();

  await expect(page.getByText("Password updated. You can log in now.")).toBeVisible();
  expect(confirmBody).toMatchObject({ token: "selector.verifier", newPassword: "Password1" });
});

test("legacy query reset tokens still work", async ({ page }) => {
  let confirmBody: Record<string, unknown> | null = null;
  await mockApi(page, {
    "POST /auth/password-reset/confirm": ({ body }) => {
      confirmBody = body;
      return { body: { status: "PASSWORD_RESET" } };
    }
  });

  await page.goto("/auth/reset-password?token=legacy.selector");
  await page.getByRole("textbox", { name: "Password", exact: true }).fill("Password1");
  await page.getByLabel("Confirm password").fill("Password1");
  await page.getByRole("button", { name: "Update password" }).click();

  expect(confirmBody).toMatchObject({ token: "legacy.selector", newPassword: "Password1" });
});

test("Google login can complete through the test provider token", async ({ page }) => {
  let googleBody: Record<string, unknown> | null = null;
  await mockApi(page, {
    "POST /auth/google": ({ body }) => {
      googleBody = body;
      return { body: customerSession };
    }
  });

  await page.goto("/auth/login");
  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page).toHaveURL(/\/en$/);
  expect(googleBody).toMatchObject({ idToken: "e2e-google-token-value" });
});

async function mockApi(page: Page, handlers: Record<string, ApiHandler>) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const key = `${request.method()} ${url.pathname.replace(/^\/api/, "")}`;
    const handler = handlers[key];
    if (!handler) {
      await route.fulfill({
        contentType: "application/json",
        status: 404,
        body: JSON.stringify({ message: `Unhandled API route ${key}` })
      });
      return;
    }

    const response = await handler({
      body: request.postData() ? (request.postDataJSON() as Record<string, unknown>) : {},
      headers: request.headers(),
      url
    });
    await route.fulfill({
      contentType: "application/json",
      headers: response.headers,
      status: response.status ?? 200,
      body: JSON.stringify(response.body ?? {})
    });
  });
}

function session(roleCodes: string[]) {
  const redirectTo = roleCodes.includes("MERCHANT_OWNER") ? "/merchant/onboarding" : "/";
  return {
    sessionId: "session-1",
    accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    redirectTo,
    routeState: {
      merchantStoreId: roleCodes.includes("MERCHANT_OWNER") ? "store-1" : null,
      merchantStoreStatus: roleCodes.includes("MERCHANT_OWNER") ? "PENDING" : null,
      onboardingState: roleCodes.includes("MERCHANT_OWNER") ? "PENDING" : null,
      onboardingComplete: false,
      redirectTo
    },
    user: {
      id: "user-1",
      email: "buyer@example.com",
      fullName: "Buyer",
      avatarUrl: null,
      status: "ACTIVE",
      emailVerified: true,
      authzVersion: 1,
      roleCodes
    }
  };
}

function accountProfile() {
  return {
    id: "user-1",
    email: "buyer@example.com",
    fullName: "Buyer One",
    avatarUrl: null,
    phone: "+919876543210",
    emailVerified: true,
    marketingOptIn: true,
    loyaltyTier: "STANDARD",
    providerType: "EMAIL",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    profileVersion: "2026-01-02T00:00:00.000Z"
  };
}
