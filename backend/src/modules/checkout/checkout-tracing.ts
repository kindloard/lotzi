import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import type { StageTiming } from "../../common/request-timing";

export interface CheckoutTraceConfig {
  enabled: boolean;
  sampleRate: number;
  queryTraceEnabled: boolean;
  maxQueriesPerRequest: number;
  maxBytesPerRequest: number;
  allowHighProductionSample: boolean;
  nodeEnv: string;
}

export interface CheckoutTraceContext {
  requestId?: string;
  userId?: string;
  storeId?: string;
  paymentMethod?: string;
  cartLineCount?: number;
  sampled: boolean;
  queryTraceEnabled: boolean;
  maxQueriesPerRequest: number;
  maxBytesPerRequest: number;
  queryCount: number;
  queryCapReached: boolean;
  byteCount: number;
  queries: CheckoutQueryTrace[];
}

export interface CheckoutQueryTrace {
  durationMs: number;
  queryFingerprint: string;
  model?: string;
  action?: string;
}

export interface CheckoutTraceFlush {
  requestId?: string;
  userId?: string;
  storeId?: string;
  paymentMethod?: string;
  cartLineCount?: number;
  sampled: boolean;
  queryTraceEnabled: boolean;
  queryCount: number;
  queryCapReached: boolean;
  byteCount: number;
  stages: StageTiming[];
  queries: CheckoutQueryTrace[];
}

type LoggerLike = {
  log?: (message: string) => void;
  warn?: (message: string) => void;
};

const checkoutTraceStorage = new AsyncLocalStorage<CheckoutTraceContext>();

export const REQUIRED_CHECKOUT_TIMING_STAGES = [
  "auth",
  "rbac",
  "csrf",
  "rate_limit",
  "resolve_intent",
  "idempotency_reserve",
  "product_store_load",
  "address_load",
  "customer_load",
  "quote_calc",
  "order_create_tx_wait",
  "order_create_tx",
  "inventory_reserve",
  "cod_confirm_tx_wait",
  "cod_confirm_tx",
  "idempotency_complete",
  "total"
] as const;

export function checkoutTraceConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CheckoutTraceConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const sampleRate = parseSampleRate(env.CHECKOUT_TRACE_SAMPLE_RATE ?? defaultSampleRate(nodeEnv));
  const allowHighProductionSample = env.CHECKOUT_TRACE_ALLOW_HIGH_PROD_SAMPLE === "true";
  if (nodeEnv === "production" && sampleRate > 0.01 && !allowHighProductionSample) {
    throw new Error(
      "CHECKOUT_TRACE_SAMPLE_RATE must be <= 0.01 in production unless CHECKOUT_TRACE_ALLOW_HIGH_PROD_SAMPLE=true."
    );
  }

  return {
    enabled: env.CHECKOUT_TRACE_ENABLED === "true",
    sampleRate,
    queryTraceEnabled: env.CHECKOUT_QUERY_TRACE_ENABLED === "true",
    maxQueriesPerRequest: positiveInt(env.CHECKOUT_TRACE_MAX_QUERIES_PER_REQUEST, 40),
    maxBytesPerRequest: positiveInt(env.CHECKOUT_TRACE_MAX_BYTES_PER_REQUEST, 32_768),
    allowHighProductionSample,
    nodeEnv
  };
}

export function shouldEnableCheckoutQueryEvents(env: NodeJS.ProcessEnv = process.env) {
  const config = checkoutTraceConfigFromEnv(env);
  return config.enabled && config.queryTraceEnabled && config.sampleRate > 0;
}

export function createCheckoutTraceContext(input: {
  requestId?: string;
  userId?: string;
  paymentMethod?: string;
  cartLineCount?: number;
  config?: CheckoutTraceConfig;
}): CheckoutTraceContext {
  const config = input.config ?? checkoutTraceConfigFromEnv();
  const sampled = config.enabled && config.sampleRate > 0 && Math.random() < config.sampleRate;
  return {
    requestId: input.requestId,
    userId: input.userId,
    paymentMethod: input.paymentMethod,
    cartLineCount: input.cartLineCount,
    sampled,
    queryTraceEnabled: sampled && config.queryTraceEnabled,
    maxQueriesPerRequest: config.maxQueriesPerRequest,
    maxBytesPerRequest: config.maxBytesPerRequest,
    queryCount: 0,
    queryCapReached: false,
    byteCount: 0,
    queries: []
  };
}

export function runCheckoutTraceContext<T>(context: CheckoutTraceContext, callback: () => Promise<T>): Promise<T> {
  return checkoutTraceStorage.run(context, callback);
}

export function getCheckoutTraceContext() {
  return checkoutTraceStorage.getStore();
}

export function updateCheckoutTraceContext(input: Partial<Pick<CheckoutTraceContext, "storeId" | "paymentMethod" | "cartLineCount">>) {
  try {
    const context = getCheckoutTraceContext();
    if (!context) return;
    Object.assign(context, input);
  } catch {
    // Trace context updates are best-effort only.
  }
}

export function recordCheckoutQueryTrace(event: Pick<Prisma.QueryEvent, "duration" | "query"> & Partial<Prisma.QueryEvent>) {
  try {
    const context = getCheckoutTraceContext();
    if (!context?.sampled || !context.queryTraceEnabled || context.queryCapReached) {
      return;
    }
    if (context.queryCount >= context.maxQueriesPerRequest) {
      context.queryCapReached = true;
      return;
    }

    const trace: CheckoutQueryTrace = {
      durationMs: event.duration,
      queryFingerprint: sanitizeQueryFingerprint(event.query)
    };
    const serialized = JSON.stringify(trace);
    const nextBytes = context.byteCount + Buffer.byteLength(serialized, "utf8");
    if (nextBytes > context.maxBytesPerRequest) {
      context.queryCapReached = true;
      return;
    }

    context.queries.push(trace);
    context.queryCount += 1;
    context.byteCount = nextBytes;
    if (context.queryCount >= context.maxQueriesPerRequest) {
      context.queryCapReached = true;
    }
  } catch {
    // Query tracing must never block Prisma work.
  }
}

export function checkoutTraceSnapshot(stages: StageTiming[]): CheckoutTraceFlush | null {
  try {
    const context = getCheckoutTraceContext();
    if (!context?.sampled) {
      return null;
    }
    return {
      requestId: context.requestId,
      userId: context.userId,
      storeId: context.storeId,
      paymentMethod: context.paymentMethod,
      cartLineCount: context.cartLineCount,
      sampled: context.sampled,
      queryTraceEnabled: context.queryTraceEnabled,
      queryCount: context.queryCount,
      queryCapReached: context.queryCapReached,
      byteCount: context.byteCount,
      stages,
      queries: [...context.queries]
    };
  } catch {
    return null;
  }
}

export function flushCheckoutTrace(
  stages: StageTiming[],
  logger?: LoggerLike,
  outcome: "completed" | "failed" = "completed"
): CheckoutTraceFlush | null {
  try {
    const snapshot = checkoutTraceSnapshot(stages);
    if (!snapshot) {
      return null;
    }
    const payload = {
      event: "checkout.trace",
      requestId: snapshot.requestId,
      userId: snapshot.userId,
      storeId: snapshot.storeId,
      paymentMethod: snapshot.paymentMethod,
      cartLineCount: snapshot.cartLineCount,
      queryCount: snapshot.queryCount,
      "checkout.trace.query_cap_reached": snapshot.queryCapReached,
      traceCapStatus: snapshot.queryCapReached ? "query_cap_reached" : "ok",
      byteCount: snapshot.byteCount,
      stages: snapshot.stages.map((stage) => ({
        stage: stage.stage,
        durationMs: Math.round(stage.durationMs * 10) / 10,
        outcome
      })),
      queries: snapshot.queries
    };
    safeLog(logger, JSON.stringify(payload));
    if (snapshot.queryCapReached) {
      safeWarn(logger, JSON.stringify({
        event: "checkout.trace.query_cap_reached",
        requestId: snapshot.requestId,
        userId: snapshot.userId,
        storeId: snapshot.storeId,
        paymentMethod: snapshot.paymentMethod,
        cartLineCount: snapshot.cartLineCount,
        queryCount: snapshot.queryCount
      }));
    }
    return snapshot;
  } catch {
    return null;
  }
}

export function sanitizeQueryFingerprint(query: string) {
  return query
    .replace(/'([^']|'')*'/g, "?")
    .replace(/\b\d+(\.\d+)?\b/g, "?")
    .replace(/\$\d+/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function parseSampleRate(value: string) {
  if (!/^(0(\.\d+)?|1(\.0+)?)$/.test(value)) {
    throw new Error("CHECKOUT_TRACE_SAMPLE_RATE must be a decimal fraction from 0.0 to 1.0.");
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("CHECKOUT_TRACE_SAMPLE_RATE must be a decimal fraction from 0.0 to 1.0.");
  }
  return parsed;
}

function defaultSampleRate(nodeEnv: string) {
  return nodeEnv === "staging" ? "1.0" : "0.0";
}

function positiveInt(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeLog(logger: LoggerLike | undefined, message: string) {
  try {
    if (logger?.log) {
      logger.log(message);
      return;
    }
    console.log(message);
  } catch {
    // Logging failures are intentionally swallowed.
  }
}

function safeWarn(logger: LoggerLike | undefined, message: string) {
  try {
    if (logger?.warn) {
      logger.warn(message);
      return;
    }
    console.warn(message);
  } catch {
    // Logging failures are intentionally swallowed.
  }
}
