import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { paymentError } from "../../modules/payments/payment.errors";
import { paiseToCashfreeAmount } from "../../modules/payments/money";

interface CashfreeCreateOrderInput {
  cashfreeOrderId: string;
  amountPaise: bigint;
  currency: string;
  customer: {
    id: string;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  returnUrl: string;
  notifyUrl?: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface CashfreeOrderResponse {
  cf_order_id?: string;
  order_id: string;
  order_status?: string;
  payment_session_id?: string;
  order_amount?: number;
  order_currency?: string;
  payments?: {
    url?: string;
  };
  [key: string]: unknown;
}

export interface CashfreePaymentResponse {
  cf_payment_id?: string;
  payment_status?: string;
  payment_amount?: number;
  payment_currency?: string;
  order_id?: string;
  [key: string]: unknown;
}

export class CashfreeGatewayError extends Error {
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
const CASHFREE_BACKOFF_MS = [500, 2_000, 8_000];
const CIRCUIT_WINDOW_MS = 60_000;
const CIRCUIT_OPEN_MS = 30_000;

@Injectable()
export class CashfreeClient {
  private readonly logger = new Logger(CashfreeClient.name);
  private readonly failures: number[] = [];
  private readonly calls: Array<{ at: number; ok: boolean }> = [];
  private circuitOpenUntil = 0;
  private halfOpenProbes = 0;

  constructor(private readonly config: ConfigService) {}

  async createOrder(input: CashfreeCreateOrderInput): Promise<CashfreeOrderResponse> {
    const body: Record<string, unknown> = {
      order_id: input.cashfreeOrderId,
      order_amount: Number(paiseToCashfreeAmount(input.amountPaise)),
      order_currency: input.currency,
      customer_details: {
        customer_id: input.customer.id,
        customer_name: input.customer.name ?? undefined,
        customer_email: input.customer.email ?? undefined,
        customer_phone: input.customer.phone ?? "9999999999"
      },
      order_meta: {
        return_url: input.returnUrl,
        notify_url: input.notifyUrl
      },
      order_note: "Namastore checkout",
      order_tags: input.metadata
    };
    return this.gatewayFetch<CashfreeOrderResponse>("/pg/orders", {
      method: "POST",
      body,
      idempotencyKey: input.idempotencyKey
    });
  }

  async getOrder(cashfreeOrderId: string): Promise<CashfreeOrderResponse> {
    return this.gatewayFetch<CashfreeOrderResponse>(`/pg/orders/${encodeURIComponent(cashfreeOrderId)}`, {
      method: "GET"
    });
  }

  async getPaymentsForOrder(cashfreeOrderId: string): Promise<CashfreePaymentResponse[]> {
    return this.gatewayFetch<CashfreePaymentResponse[]>(`/pg/orders/${encodeURIComponent(cashfreeOrderId)}/payments`, {
      method: "GET"
    });
  }

  async createRefund(input: {
    cashfreePaymentId: string;
    refundId: string;
    amountPaise: bigint;
    reason?: string;
    idempotencyKey: string;
  }): Promise<Record<string, unknown>> {
    return this.gatewayFetch<Record<string, unknown>>(
      `/pg/payments/${encodeURIComponent(input.cashfreePaymentId)}/refunds`,
      {
        method: "POST",
        idempotencyKey: input.idempotencyKey,
        body: {
          refund_id: input.refundId,
          refund_amount: Number(paiseToCashfreeAmount(input.amountPaise)),
          refund_note: input.reason ?? "Customer refund"
        }
      }
    );
  }

  verifyWebhookSignature(input: { rawBody: Buffer; timestamp: string; signature: string }): boolean {
    const secret = this.webhookSecret();
    const signedPayload = Buffer.concat([Buffer.from(input.timestamp), input.rawBody]);
    const expected = createHmac("sha256", secret).update(signedPayload).digest("base64");
    const received = Buffer.from(input.signature);
    const computed = Buffer.from(expected);
    return received.length === computed.length && timingSafeEqual(received, computed);
  }

  assertWebhookConfigured() {
    this.webhookSecret();
  }

  private async gatewayFetch<T>(path: string, input: {
    method: "GET" | "POST";
    body?: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<T> {
    this.assertConfigured();
    for (let attempt = 0; attempt < CASHFREE_BACKOFF_MS.length; attempt += 1) {
      this.assertCircuitAllowsCall();
      try {
        const result = await this.singleFetch<T>(path, input);
        this.recordCircuitResult(true);
        return result;
      } catch (error) {
        const gatewayError = normalizeGatewayError(error);
        this.recordCircuitResult(false);
        if (!gatewayError.retryable || attempt === CASHFREE_BACKOFF_MS.length - 1) {
          throw gatewayError;
        }
        await sleep(withJitter(CASHFREE_BACKOFF_MS[attempt]));
      }
    }
    throw new CashfreeGatewayError("Cashfree request failed.", true);
  }

  private async singleFetch<T>(path: string, input: {
    method: "GET" | "POST";
    body?: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.baseUrl()}${path}`, {
        method: input.method,
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-version": this.apiVersion(),
          "x-client-id": this.appId(),
          "x-client-secret": this.secretKey(),
          ...(input.idempotencyKey ? { "x-idempotency-key": input.idempotencyKey } : {})
        },
        body: input.body ? JSON.stringify(input.body) : undefined
      });
      const payload = await response.text();
      const parsed = payload ? safeJson(payload) : {};
      if (!response.ok) {
        const retryable = response.status === 409 || response.status === 429 || response.status >= 500;
        throw new CashfreeGatewayError(
          `Cashfree returned ${response.status}.`,
          retryable,
          response.status,
          parsed
        );
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new CashfreeGatewayError("Cashfree request timed out.", true, undefined, undefined, true);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertConfigured() {
    if (!this.appId() || !this.secretKey()) {
      throw paymentError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "CASHFREE_NOT_CONFIGURED",
        "Payment gateway is not configured.",
        true,
        undefined,
        60
      );
    }
  }

  private assertCircuitAllowsCall() {
    const now = Date.now();
    if (now < this.circuitOpenUntil) {
      throw new CashfreeGatewayError("Cashfree circuit is open.", true, 503);
    }
    if (this.circuitOpenUntil > 0 && now >= this.circuitOpenUntil && this.halfOpenProbes >= 3) {
      throw new CashfreeGatewayError("Cashfree circuit half-open probe limit reached.", true, 503);
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
      this.logger.warn("Cashfree circuit opened for 30s.");
    }
  }

  private baseUrl() {
    return this.config.get<string>("CASHFREE_BASE_URL") ?? (
      this.config.get<string>("CASHFREE_ENV", "sandbox") === "production"
        ? "https://api.cashfree.com"
        : "https://sandbox.cashfree.com"
    );
  }

  private apiVersion() {
    return this.config.get<string>("CASHFREE_API_VERSION", "2025-01-01");
  }

  private appId() {
    return this.config.get<string>("CASHFREE_APP_ID", "");
  }

  private secretKey() {
    return this.config.get<string>("CASHFREE_SECRET_KEY", "");
  }

  private webhookSecret() {
    return this.config.get<string>("CASHFREE_WEBHOOK_SECRET") ?? this.secretKey();
  }
}

function normalizeGatewayError(error: unknown): CashfreeGatewayError {
  if (error instanceof CashfreeGatewayError) {
    return error;
  }
  return new CashfreeGatewayError(error instanceof Error ? error.message : String(error), true);
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withJitter(ms: number) {
  return Math.round(ms * (0.8 + Math.random() * 0.4));
}
