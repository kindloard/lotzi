import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";

const BUCKETS = [
  { label: "<300ms", max: 300 },
  { label: "300-800ms", max: 800 },
  { label: "800ms-1.5s", max: 1_500 },
  { label: "1.5-5s", max: 5_000 },
  { label: "5-15s", max: 15_000 },
  { label: ">15s", max: Number.POSITIVE_INFINITY }
];

async function main() {
  const logPath = process.argv[2] ?? ".codex-backend-dev.out.log";
  if (!existsSync(logPath)) {
    throw new Error(`Log file not found: ${logPath}`);
  }

  const durations: number[] = [];
  const rl = createInterface({ input: createReadStream(logPath), crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of rl) {
    const record = parseJsonLine(line);
    if (!record) continue;
    const duration = checkoutDurationMs(record);
    if (duration !== null) {
      durations.push(duration);
    }
  }

  durations.sort((a, b) => a - b);
  const summary = summarizeDurations(durations);
  console.log(JSON.stringify({
    event: "checkout.baseline_report",
    source: logPath,
    minimumRecommendedAttempts: 20,
    ...summary
  }, null, 2));
}

function checkoutDurationMs(record: Record<string, unknown>) {
  if (record.event === "checkout.trace" && Array.isArray(record.stages)) {
    const total = record.stages.find(
      (stage): stage is { stage: string; durationMs: number } =>
        Boolean(stage) &&
        typeof stage === "object" &&
        "stage" in stage &&
        "durationMs" in stage &&
        stage.stage === "total" &&
        typeof stage.durationMs === "number"
    );
    return total?.durationMs ?? null;
  }

  const request = record.req;
  const url =
    request && typeof request === "object" && "url" in request
      ? String((request as { url?: unknown }).url ?? "")
      : "";
  if (!url.includes("/api/v1/checkout/session")) {
    return null;
  }
  const responseTime = record.responseTime;
  return typeof responseTime === "number" && Number.isFinite(responseTime) ? responseTime : null;
}

function summarizeDurations(durations: number[]) {
  const buckets = Object.fromEntries(BUCKETS.map((bucket) => [bucket.label, 0]));
  for (const duration of durations) {
    const bucket = BUCKETS.find((item) => duration <= item.max) ?? BUCKETS[BUCKETS.length - 1]!;
    buckets[bucket.label] += 1;
  }

  return {
    count: durations.length,
    p50: percentile(durations, 0.5),
    p75: percentile(durations, 0.75),
    p90: percentile(durations, 0.9),
    p95: percentile(durations, 0.95),
    p99: percentile(durations, 0.99),
    max: durations.at(-1) ?? null,
    buckets
  };
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return null;
  }
  const index = Math.ceil(values.length * p) - 1;
  return Math.round(values[Math.max(0, Math.min(values.length - 1, index))]! * 10) / 10;
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
