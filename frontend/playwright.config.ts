import { defineConfig, devices } from "@playwright/test";

const e2ePort = process.env.PLAYWRIGHT_PORT ?? "3000";
const e2eUrl = `http://127.0.0.1:${e2ePort}`;
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["**/perf/**"],
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: e2eUrl,
    trace: "on-first-retry"
  },
  webServer: {
    command: `npx next dev --turbopack -H 0.0.0.0 -p ${e2ePort}`,
    env: {
      NEXT_PUBLIC_API_URL: "http://localhost:4000",
      NEXT_PUBLIC_E2E_GOOGLE_ID_TOKEN: "e2e-google-token-value"
    },
    reuseExistingServer,
    timeout: 120_000,
    url: e2eUrl
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
