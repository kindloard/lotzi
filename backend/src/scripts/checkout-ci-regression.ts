import { readFileSync } from "node:fs";
import { REQUIRED_CHECKOUT_TIMING_STAGES } from "../modules/checkout/checkout-tracing";

async function main() {
  const url = process.env.CHECKOUT_CI_GUARD_URL ?? "http://localhost:4000/api/v1/checkout/session";
  const cookie = requiredEnv("CHECKOUT_CI_GUARD_COOKIE");
  const csrf = requiredEnv("CHECKOUT_CI_GUARD_CSRF");
  const payloadPath = requiredEnv("CHECKOUT_CI_GUARD_PAYLOAD_FILE");
  const thresholdMs = positiveInt(process.env.CHECKOUT_CI_GUARD_TOTAL_THRESHOLD_MS, 5_000);
  const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as Record<string, unknown>;

  const startedAt = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cookie": cookie,
      "x-csrf-token": csrf
    },
    body: JSON.stringify({
      ...payload,
      idempotencyKey: `${String(payload.idempotencyKey ?? "ci")}-${Date.now()}`
    })
  });
  const body = await response.text().catch(() => "");
  const wallMs = Math.round((performance.now() - startedAt) * 10) / 10;
  const serverTiming = response.headers.get("server-timing") ?? "";
  const stageDurations = parseServerTiming(serverTiming);
  const missingStages = REQUIRED_CHECKOUT_TIMING_STAGES.filter((stage) => !stageDurations.has(stage));
  const total = stageDurations.get("total") ?? wallMs;

  const result = {
    event: "checkout.ci_regression_guard",
    status: response.status,
    requestId: response.headers.get("x-request-id"),
    wallMs,
    serverTiming,
    total,
    thresholdMs,
    missingStages
  };
  console.log(JSON.stringify(result, null, 2));

  if (!response.ok) {
    throw new Error(`Checkout smoke failed with HTTP ${response.status}: ${body.slice(0, 500)}`);
  }
  if (missingStages.length > 0) {
    throw new Error(`Checkout Server-Timing is missing stages: ${missingStages.join(", ")}`);
  }
  if (total > thresholdMs) {
    throw new Error(`Checkout Server-Timing total ${total}ms exceeded threshold ${thresholdMs}ms.`);
  }
}

function parseServerTiming(header: string) {
  const stages = new Map<string, number>();
  for (const item of header.split(",")) {
    const [name, ...params] = item.trim().split(";");
    const dur = params.find((param) => param.trim().startsWith("dur="));
    if (!name || !dur) continue;
    const parsed = Number(dur.trim().slice("dur=".length));
    if (Number.isFinite(parsed)) {
      stages.set(name, parsed);
    }
  }
  return stages;
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
