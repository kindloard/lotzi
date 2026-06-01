import { createReadStream, existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

async function main() {
  const requestId = process.argv[2] ?? process.env.CHECKOUT_TRACE_REQUEST_ID;
  const logPath = process.argv[3] ?? ".codex-backend-dev.out.log";
  const frontendMarksPath = process.argv[4] ?? process.env.CHECKOUT_FRONTEND_MARKS_FILE;
  if (!requestId) {
    throw new Error("Usage: npm run perf:checkout:trace -- <x-request-id> [log-file] [frontend-marks-json]");
  }
  if (!existsSync(logPath)) {
    throw new Error(`Log file not found: ${logPath}`);
  }

  const records: Record<string, unknown>[] = [];
  const rl = createInterface({ input: createReadStream(logPath), crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of rl) {
    const parsed = parseJsonLine(line);
    if (!parsed || recordRequestId(parsed) !== requestId) continue;
    records.push(parsed);
  }

  const checkoutTrace = records.find((record) => record.event === "checkout.trace");
  const response = records.find((record) => {
    const req = record.req as { url?: unknown } | undefined;
    return typeof req?.url === "string" && req.url.includes("/api/v1/checkout/session");
  });

  console.log(JSON.stringify({
    event: "checkout.trace_waterfall",
    requestId,
    responseTime: typeof response?.responseTime === "number" ? response.responseTime : null,
    serverTiming: responseServerTiming(response),
    frontend: frontendMarksPath ? readFrontendMarks(frontendMarksPath, requestId) : null,
    checkoutTrace,
    matchingRecordCount: records.length
  }, null, 2));
}

function readFrontendMarks(path: string, requestId: string) {
  if (!existsSync(path)) {
    throw new Error(`Frontend marks file not found: ${path}`);
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (Array.isArray(parsed)) {
    return parsed.filter((entry) => {
      return Boolean(
        entry &&
        typeof entry === "object" &&
        "requestId" in entry &&
        (entry as { requestId?: unknown }).requestId === requestId
      );
    });
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as { requestId?: unknown };
    return record.requestId === requestId ? parsed : null;
  }
  return null;
}

function responseServerTiming(record: Record<string, unknown> | undefined) {
  const res = record?.res as { headers?: Record<string, unknown> } | undefined;
  const headers = res?.headers ?? {};
  return headers["server-timing"] ?? headers["Server-Timing"] ?? null;
}

function recordRequestId(record: Record<string, unknown>) {
  if (typeof record.requestId === "string") {
    return record.requestId;
  }
  const req = record.req as { id?: unknown; headers?: Record<string, unknown> } | undefined;
  return typeof req?.id === "string"
    ? req.id
    : typeof req?.headers?.["x-request-id"] === "string"
      ? req.headers["x-request-id"]
      : undefined;
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
