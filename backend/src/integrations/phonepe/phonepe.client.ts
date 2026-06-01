import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, timingSafeEqual } from "node:crypto";
import { paymentError } from "../../modules/payments/payment.errors";

export type PhonepeEnvironment = "SANDBOX" | "PRODUCTION";

export interface PhonepeCredentials {
  merchantId: string;
  clientId: string;
  clientSecret: string;
  clientVersion: string;
  saltKey?: string | null;
  saltIndex?: string | null;
  environment: PhonepeEnvironment;
}

export interface PhonepeCreatePaymentInput {
  credentials: PhonepeCredentials;
  merchantOrderId: string;
  amountPaise: bigint;
  redirectUrl: string;
  expireAfterSeconds?: number;
  metadata?: Record<string, string>;
}

export interface PhonepeCreatePaymentResponse {
  orderId?: string;
  state?: string;
  redirectUrl?: string;
  paymentUrl?: string;
  instrumentResponse?: {
    redirectInfo?: {
      url?: string;
    };
  };
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PhonepeStatusResponse {
  orderId?: string;
  merchantOrderId?: string;
  state?: string;
  status?: string;
  amount?: number;
  paymentDetails?: Array<Record<string, unknown>>;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export class PhonepeGatewayError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly responseBody?: unknown,
    readonly timedOut = false
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
const PHONEPE_BACKOFF_MS = [500, 2_000, 8_000];
const CIRCUIT_WINDOW_MS = 60_000;
const CIRCUIT_OPEN_MS = 30_000;
const DEFAULT_CLIENT_VERSION = "1";
const DEFAULT_EXPIRE_AFTER_SECONDS = 15 * 60;

@Injectable()
export class PhonepeClient {
  private readonly logger = new Logger(PhonepeClient.name);
  private readonly failures: number[] = [];
  private readonly calls: Array<{ at: number; ok: boolean }> = [];
  private readonly tokenCache = new Map<string, { token: string; expiresAt: number }>();
  private circuitOpenUntil = 0;
  private halfOpenProbes = 0;

  constructor(private readonly config: ConfigService) {}

  async testConnection(credentials: PhonepeCredentials) {
    const token = await this.authToken(credentials, true);
    return { ok: true, tokenExpiresAt: token.expiresAt };
  }

  async createPayment(input: PhonepeCreatePaymentInput): Promise<PhonepeCreatePaymentResponse> {
    assertSafeAmount(input.amountPaise);
    const body = {
      merchantOrderId: input.merchantOrderId,
      amount: Number(input.amountPaise),
      expireAfter: input.expireAfterSeconds ?? DEFAULT_EXPIRE_AFTER_SECONDS,
      metaInfo: phonepeMetaInfo(input.metadata),
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: "Namastore checkout",
        merchantUrls: {
          redirectUrl: input.redirectUrl
        }
      }
    };

    return this.gatewayFetch<PhonepeCreatePaymentResponse>(
      input.credentials,
      "/checkout/v2/pay",
      {
        method: "POST",
        body
      }
    );
  }

  async checkStatus(credentials: PhonepeCredentials, merchantOrderId: string): Promise<PhonepeStatusResponse> {
    return this.gatewayFetch<PhonepeStatusResponse>(
      credentials,
      `/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status`,
      { method: "GET" }
    );
  }

  async refund(input: {
    credentials: PhonepeCredentials;
    merchantRefundId: string;
    originalMerchantOrderId: string;
    amountPaise: bigint;
  }): Promise<Record<string, unknown>> {
    assertSafeAmount(input.amountPaise);
    return this.gatewayFetch<Record<string, unknown>>(input.credentials, "/payments/v2/refund", {
      method: "POST",
      body: {
        merchantRefundId: input.merchantRefundId,
        originalMerchantOrderId: input.originalMerchantOrderId,
        amount: Number(input.amountPaise)
      }
    });
  }

  redirectUrlFromResponse(response: PhonepeCreatePaymentResponse): string | null {
    return (
      stringAt(response, ["redirectUrl"]) ??
      stringAt(response, ["paymentUrl"]) ??
      stringAt(response, ["instrumentResponse", "redirectInfo", "url"]) ??
      stringAt(response, ["data", "redirectUrl"]) ??
      stringAt(response, ["data", "paymentUrl"]) ??
      stringAt(response, ["data", "instrumentResponse", "redirectInfo", "url"])
    );
  }

  normalizeStatus(response: PhonepeStatusResponse): "PAID" | "FAILED" | "PENDING" | "USER_DROPPED" | "EXPIRED" {
    const value = (
      stringAt(response, ["state"]) ??
      stringAt(response, ["status"]) ??
      stringAt(response, ["data", "state"]) ??
      stringAt(response, ["data", "status"]) ??
      ""
    ).toUpperCase();

    if (["COMPLETED", "SUCCESS", "PAID"].includes(value)) return "PAID";
    if (["FAILED", "PAYMENT_ERROR", "DECLINED", "CANCELLED"].includes(value)) return "FAILED";
    if (["EXPIRED", "TIMED_OUT"].includes(value)) return "EXPIRED";
    if (["USER_DROPPED", "USER_CANCELLED"].includes(value)) return "USER_DROPPED";
    return "PENDING";
  }

  amountPaiseFromStatus(response: PhonepeStatusResponse, fallback: bigint): bigint {
    const direct = numberAt(response, ["amount"]) ?? numberAt(response, ["data", "amount"]);
    if (direct != null) {
      return BigInt(Math.round(direct));
    }
    return fallback;
  }

  gatewayPaymentIdFromStatus(response: PhonepeStatusResponse, fallback: string): string {
    const details = arrayAt(response, ["paymentDetails"]) ?? arrayAt(response, ["data", "paymentDetails"]);
    const first = details?.[0];
    if (first && typeof first === "object") {
      return (
        stringAt(first as Record<string, unknown>, ["transactionId"]) ??
        stringAt(first as Record<string, unknown>, ["paymentId"]) ??
        stringAt(first as Record<string, unknown>, ["utr"]) ??
        fallback
      );
    }
    return (
      stringAt(response, ["transactionId"]) ??
      stringAt(response, ["paymentId"]) ??
      stringAt(response, ["data", "transactionId"]) ??
      fallback
    );
  }

  validateLegacyXVerify(input: {
    encodedResponse: string;
    path?: string;
    xVerify: string;
    credentials: Pick<PhonepeCredentials, "saltKey" | "saltIndex">;
  }) {
    if (!input.credentials.saltKey || !input.credentials.saltIndex) {
      return false;
    }
    const candidates = [
      `${sha256(`${input.encodedResponse}${input.credentials.saltKey}`)}###${input.credentials.saltIndex}`,
      `${sha256(`${input.encodedResponse}${input.path ?? ""}${input.credentials.saltKey}`)}###${input.credentials.saltIndex}`
    ];
    return candidates.some((candidate) => timingSafeStringEqual(candidate, input.xVerify));
  }

  legacyPayloadFromBody(body: unknown): { encodedResponse: string; payload: Record<string, unknown> } | null {
    const encodedResponse =
      body && typeof body === "object" && "response" in body
        ? (body as { response?: unknown }).response
        : undefined;
    if (typeof encodedResponse !== "string" || !encodedResponse.trim()) {
      return null;
    }
    const decoded = Buffer.from(encodedResponse, "base64").toString("utf8");
    return { encodedResponse, payload: safeJson(decoded) as Record<string, unknown> };
  }

  private async gatewayFetch<T>(
    credentials: PhonepeCredentials,
    path: string,
    input: {
      method: "GET" | "POST";
      body?: Record<string, unknown>;
    }
  ): Promise<T> {
    this.assertConfigured(credentials);
    for (let attempt = 0; attempt < PHONEPE_BACKOFF_MS.length; attempt += 1) {
      this.assertCircuitAllowsCall();
      try {
        const token = await this.authToken(credentials);
        const result = await this.singleFetch<T>(credentials, path, {
          ...input,
          authorization: `O-Bearer ${token.token}`
        });
        this.recordCircuitResult(true);
        return result;
      } catch (error) {
        const gatewayError = normalizeGatewayError(error);
        this.recordCircuitResult(false);
        if (!gatewayError.retryable || attempt === PHONEPE_BACKOFF_MS.length - 1) {
          throw gatewayError;
        }
        await sleep(withJitter(PHONEPE_BACKOFF_MS[attempt]!));
      }
    }
    throw new PhonepeGatewayError("PhonePe request failed.", true);
  }

  private async authToken(credentials: PhonepeCredentials, force = false) {
    this.assertConfigured(credentials);
    const cacheKey = [
      credentials.environment,
      credentials.clientId,
      credentials.clientVersion || DEFAULT_CLIENT_VERSION
    ].join(":");
    const cached = this.tokenCache.get(cacheKey);
    if (!force && cached && cached.expiresAt - Date.now() > 60_000) {
      return cached;
    }

    const body = new URLSearchParams({
      client_id: credentials.clientId,
      client_version: credentials.clientVersion || DEFAULT_CLIENT_VERSION,
      client_secret: credentials.clientSecret,
      grant_type: "client_credentials"
    });

    const response = await this.singleFetch<Record<string, unknown>>(credentials, "/v1/oauth/token", {
      method: "POST",
      formBody: body
    });
    const token =
      stringAt(response, ["access_token"]) ??
      stringAt(response, ["data", "access_token"]) ??
      stringAt(response, ["token"]);
    if (!token) {
      throw new PhonepeGatewayError("PhonePe did not return an access token.", true, 502, response);
    }
    const expiresAt =
      epochMsAt(response, ["expires_at"]) ??
      epochMsAt(response, ["data", "expires_at"]) ??
      Date.now() + 20 * 60 * 1000;
    const cachedToken = { token, expiresAt };
    this.tokenCache.set(cacheKey, cachedToken);
    return cachedToken;
  }

  private async singleFetch<T>(
    credentials: PhonepeCredentials,
    path: string,
    input: {
      method: "GET" | "POST";
      body?: Record<string, unknown>;
      formBody?: URLSearchParams;
      authorization?: string;
    }
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl(credentials)}${path}`, {
        method: input.method,
        signal: controller.signal,
        headers: {
          "content-type": input.formBody ? "application/x-www-form-urlencoded" : "application/json",
          ...(input.authorization ? { authorization: input.authorization } : {})
        },
        body: input.formBody?.toString() ?? (input.body ? JSON.stringify(input.body) : undefined)
      });
      const payload = await response.text();
      const parsed = payload ? safeJson(payload) : {};
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
        throw new PhonepeGatewayError(`PhonePe returned ${response.status}.`, retryable, response.status, parsed);
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new PhonepeGatewayError("PhonePe request timed out.", true, undefined, undefined, true);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertConfigured(credentials: PhonepeCredentials) {
    if (!credentials.merchantId || !credentials.clientId || !credentials.clientSecret) {
      throw paymentError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "PHONEPE_NOT_CONFIGURED",
        "PhonePe payment gateway is not configured.",
        true,
        undefined,
        60
      );
    }
  }

  private assertCircuitAllowsCall() {
    const now = Date.now();
    if (now < this.circuitOpenUntil) {
      throw new PhonepeGatewayError("PhonePe circuit is open.", true, 503);
    }
    if (this.circuitOpenUntil > 0 && now >= this.circuitOpenUntil && this.halfOpenProbes >= 3) {
      throw new PhonepeGatewayError("PhonePe circuit half-open probe limit reached.", true, 503);
    }
    if (this.circuitOpenUntil > 0) {
      this.halfOpenProbes += 1;
    }
  }

  private recordCircuitResult(ok: boolean) {
    const now = Date.now();
    this.calls.push({ at: now, ok });
    while (this.calls[0] && now - this.calls[0].at > CIRCUIT_WINDOW_MS) {
      this.calls.shift();
    }
    if (ok) {
      this.failures.length = 0;
      if (this.circuitOpenUntil > 0) {
        this.circuitOpenUntil = 0;
        this.halfOpenProbes = 0;
      }
      return;
    }

    this.failures.push(now);
    while (this.failures[0] && now - this.failures[0] > CIRCUIT_WINDOW_MS) {
      this.failures.shift();
    }
    const failureRate =
      this.calls.length >= 20
        ? this.calls.filter((call) => !call.ok).length / this.calls.length
        : 0;
    if (this.failures.length >= 5 || failureRate >= 0.5) {
      this.circuitOpenUntil = now + CIRCUIT_OPEN_MS;
      this.halfOpenProbes = 0;
      this.logger.warn("PhonePe circuit opened for 30s.");
    }
  }

  private baseUrl(credentials: PhonepeCredentials) {
    const configured = this.config.get<string>("PHONEPE_BASE_URL");
    if (configured) {
      return configured.replace(/\/$/, "");
    }
    return credentials.environment === "PRODUCTION"
      ? "https://api.phonepe.com/apis/pg"
      : "https://api-preprod.phonepe.com/apis/pg-sandbox";
  }
}

function phonepeMetaInfo(metadata?: Record<string, string>) {
  const entries = Object.entries(metadata ?? {}).slice(0, 5);
  return entries.reduce<Record<string, string>>((acc, [key, value], index) => {
    acc[`udf${index + 1}`] = String(value).slice(0, 256);
    return acc;
  }, {});
}

function assertSafeAmount(amountPaise: bigint) {
  if (amountPaise <= 0n || amountPaise > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw paymentError(HttpStatus.BAD_REQUEST, "PHONEPE_AMOUNT_INVALID", "PhonePe amount is outside the supported range.");
  }
}

function normalizeGatewayError(error: unknown): PhonepeGatewayError {
  if (error instanceof PhonepeGatewayError) {
    return error;
  }
  return new PhonepeGatewayError(error instanceof Error ? error.message : String(error), true);
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}

function stringAt(payload: Record<string, unknown>, path: string[]): string | null {
  let current: unknown = payload;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" || typeof current === "number" ? String(current) : null;
}

function numberAt(payload: Record<string, unknown>, path: string[]): number | null {
  const value = stringAt(payload, path);
  if (value == null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function arrayAt(payload: Record<string, unknown>, path: string[]): unknown[] | null {
  let current: unknown = payload;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? current : null;
}

function epochMsAt(payload: Record<string, unknown>, path: string[]): number | null {
  const value = numberAt(payload, path);
  if (value == null) {
    return null;
  }
  return value < 10_000_000_000 ? value * 1000 : value;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function timingSafeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withJitter(ms: number) {
  return Math.round(ms * (0.8 + Math.random() * 0.4));
}
