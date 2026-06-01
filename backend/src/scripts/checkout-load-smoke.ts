import { readFileSync } from "node:fs";

interface CheckoutLoadResult {
  status: number;
  durationMs: number;
  requestId: string | null;
  serverTiming: string | null;
  stages: Record<string, number>;
  ok: boolean;
}

async function main() {
  if (process.env.CHECKOUT_LOAD_TEST_CONFIRM_MUTATION !== "true") {
    throw new Error("Set CHECKOUT_LOAD_TEST_CONFIRM_MUTATION=true to run the mutating checkout load smoke.");
  }
  const url = process.env.CHECKOUT_LOAD_TEST_URL ?? "http://localhost:4000/api/v1/checkout/session";
  const cookie = requiredEnv("CHECKOUT_LOAD_TEST_COOKIE");
  const csrf = requiredEnv("CHECKOUT_LOAD_TEST_CSRF");
  const payloadPath = requiredEnv("CHECKOUT_LOAD_TEST_PAYLOAD_FILE");
  const concurrency = positiveInt(process.env.CHECKOUT_LOAD_TEST_CONCURRENCY, 5);
  const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as Record<string, unknown>;

  const results = await Promise.all(
    Array.from({ length: concurrency }, (_, index) =>
      executeCheckout(url, cookie, csrf, {
        ...payload,
        idempotencyKey: `${String(payload.idempotencyKey ?? "load")}-${Date.now()}-${index}`
      })
    )
  );

  const durations = results.map((result) => result.durationMs).sort((a, b) => a - b);
  console.log(JSON.stringify({
    event: "checkout.load_smoke",
    concurrency,
    count: results.length,
    ok: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    latency: {
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      p99: percentile(durations, 0.99),
      max: durations.at(-1) ?? null
    },
    results
  }, null, 2));
}

async function executeCheckout(
  url: string,
  cookie: string,
  csrf: string,
  payload: Record<string, unknown>
): Promise<CheckoutLoadResult> {
  const startedAt = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cookie": cookie,
      "x-csrf-token": csrf
    },
    body: JSON.stringify(payload)
  });
  await response.text().catch(() => "");
  return {
    status: response.status,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    requestId: response.headers.get("x-request-id"),
    serverTiming: response.headers.get("server-timing"),
    stages: parseServerTiming(response.headers.get("server-timing") ?? ""),
    ok: response.ok
  };
}

function parseServerTiming(header: string) {
  const stages: Record<string, number> = {};
  for (const item of header.split(",")) {
    const [name, ...params] = item.trim().split(";");
    const dur = params.find((param) => param.trim().startsWith("dur="));
    if (!name || !dur) continue;
    const parsed = Number(dur.trim().slice("dur=".length));
    if (Number.isFinite(parsed)) {
      stages[name] = parsed;
    }
  }
  return stages;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return null;
  }
  const index = Math.ceil(values.length * p) - 1;
  return Math.round(values[Math.max(0, Math.min(values.length - 1, index))]! * 10) / 10;
}

function requiredEnv(key: string) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is required.`);
  }
  return value;
}

function positiveInt(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
