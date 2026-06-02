import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OTP_DIGITS } from "../../security/security.constants";
import { ObservabilityService } from "../observability/observability.service";
import { OtpProvider, OtpProviderError, SendOtpInput, SendOtpResult } from "./phone-otp.provider";

type CircuitState = "closed" | "half_open" | "open";
type Fast2SmsOtpMode = "BULKV2_OTP" | "TEMPLATE_OTP" | "DLT_SMS" | "QUICK_SMS";

@Injectable()
export class Fast2SmsOtpProvider implements OtpProvider {
  readonly name = "FAST2SMS" as const;
  private readonly logger = new Logger(Fast2SmsOtpProvider.name);
  private failures = 0;
  private circuitState: CircuitState = "closed";
  private circuitOpenedUntil = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly observability: ObservabilityService
  ) {}

  async sendOtp(input: SendOtpInput): Promise<SendOtpResult> {
    this.assertCircuitAllowsRequest();
    const mode = this.config.get<Fast2SmsOtpMode>("FAST2SMS_OTP_MODE", "BULKV2_OTP");
    const apiKey = this.config.get<string>("FAST2SMS_API_KEY");
    if (!apiKey) {
      throw new OtpProviderError("Fast2SMS is not configured.", "OTP_PROVIDER_UNAVAILABLE", true);
    }
    if (mode === "TEMPLATE_OTP" && !this.config.get<string>("FAST2SMS_OTP_TEMPLATE_ID")) {
      throw new OtpProviderError("Fast2SMS OTP template is not configured.", "OTP_PROVIDER_TEMPLATE_INVALID", false);
    }
    if (
      mode === "DLT_SMS" &&
      (!this.config.get<string>("FAST2SMS_DLT_SENDER_ID") || !this.config.get<string>("FAST2SMS_DLT_MESSAGE_ID"))
    ) {
      throw new OtpProviderError("Fast2SMS DLT sender ID or message ID is not configured.", "OTP_PROVIDER_TEMPLATE_INVALID", false);
    }

    const attempts = this.config.get<number>("FAST2SMS_RETRY_COUNT", 1) + 1;
    let lastError: unknown;
    for (let index = 0; index < attempts; index += 1) {
      try {
        const result = await this.sendOnce(input, apiKey, mode);
        this.recordSuccess();
        return result;
      } catch (error) {
        lastError = error;
        if (error instanceof OtpProviderError && !error.retryable) {
          throw error;
        }
        if (!(error instanceof OtpProviderError)) {
          this.recordFailure();
          throw error;
        }
      }
    }

    this.recordFailure();
    throw lastError instanceof OtpProviderError
      ? lastError
      : new OtpProviderError("Fast2SMS request failed.", "OTP_PROVIDER_UNAVAILABLE", true);
  }

  circuit(): CircuitState {
    return this.circuitState;
  }

  private async sendOnce(
    input: SendOtpInput,
    apiKey: string,
    mode: Fast2SmsOtpMode
  ): Promise<SendOtpResult> {
    const baseUrl = this.config.get<string>("FAST2SMS_BASE_URL", "https://www.fast2sms.com").replace(/\/$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.get<number>("FAST2SMS_TIMEOUT_MS", 5_000)
    );

    try {
      let response = await this.sendByMode(baseUrl, apiKey, input, mode, controller.signal);
      let body = await safeJson(response);
      if (
        mode === "BULKV2_OTP" &&
        (!response.ok || providerReturnedFailure(body)) &&
        shouldTryBulkV2FormFallback(response.status, body)
      ) {
        response = await this.sendBulkV2OtpForm(baseUrl, apiKey, input, controller.signal);
        body = await safeJson(response);
      }
      if (!response.ok || providerReturnedFailure(body)) {
        throw this.mapProviderFailure(response.status, body);
      }
      const providerMessageId =
        stringFromBody(body, "request_id") ??
        stringFromBody(body, "request_ids") ??
        stringFromBody(body, "message_id") ??
        stringFromBody(body, "otp_id");
      return {
        accepted: true,
        providerMessageId,
        rawStatus: truncateProviderStatus(stringFromBody(body, "message") ?? "accepted")
      };
    } catch (error) {
      if (error instanceof OtpProviderError) {
        throw error;
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new OtpProviderError("Fast2SMS timed out.", "OTP_PROVIDER_TIMEOUT", true);
      }
      throw new OtpProviderError("Fast2SMS is unavailable.", "OTP_PROVIDER_UNAVAILABLE", true);
    } finally {
      clearTimeout(timeout);
    }
  }

  private sendTemplateOtp(
    baseUrl: string,
    apiKey: string,
    input: SendOtpInput,
    signal: AbortSignal
  ) {
    return fetch(`${baseUrl}/dev/otp/send`, {
      method: "POST",
      signal,
      headers: {
        accept: "application/json",
        authorization: apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        mobile: input.mobile,
        otp_id: this.config.get<string>("FAST2SMS_OTP_TEMPLATE_ID"),
        otp_expiry: Math.max(1, input.otpExpiryMinutes),
        otp_length: OTP_DIGITS,
        otp: input.otp
      })
    });
  }

  private sendByMode(
    baseUrl: string,
    apiKey: string,
    input: SendOtpInput,
    mode: Fast2SmsOtpMode,
    signal: AbortSignal
  ) {
    if (mode === "TEMPLATE_OTP") {
      return this.sendTemplateOtp(baseUrl, apiKey, input, signal);
    }
    if (mode === "DLT_SMS") {
      return this.sendDltSms(baseUrl, apiKey, input, signal);
    }
    if (mode === "QUICK_SMS") {
      return this.sendQuickSms(baseUrl, apiKey, input, signal);
    }
    return this.sendBulkV2Otp(baseUrl, apiKey, input, signal);
  }

  private sendBulkV2Otp(
    baseUrl: string,
    apiKey: string,
    input: SendOtpInput,
    signal: AbortSignal
  ) {
    return fetch(`${baseUrl}/dev/bulkV2`, {
      method: "POST",
      signal,
      headers: {
        accept: "application/json",
        authorization: apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        route: "otp",
        variables_values: input.otp,
        numbers: input.mobile,
        flash: 0
      })
    });
  }

  private sendBulkV2OtpForm(
    baseUrl: string,
    apiKey: string,
    input: SendOtpInput,
    signal: AbortSignal
  ) {
    return fetch(`${baseUrl}/dev/bulkV2`, {
      method: "POST",
      signal,
      headers: {
        accept: "application/json",
        authorization: apiKey,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        route: "otp",
        variables_values: input.otp,
        numbers: input.mobile,
        flash: "0"
      }).toString()
    });
  }

  private sendDltSms(
    baseUrl: string,
    apiKey: string,
    input: SendOtpInput,
    signal: AbortSignal
  ) {
    return fetch(`${baseUrl}/dev/bulkV2`, {
      method: "POST",
      signal,
      headers: {
        accept: "application/json",
        authorization: apiKey,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        sender_id: this.config.get<string>("FAST2SMS_DLT_SENDER_ID", ""),
        message: this.config.get<string>("FAST2SMS_DLT_MESSAGE_ID", ""),
        variables_values: this.dltVariables(input.otp),
        route: "dlt",
        numbers: input.mobile,
        flash: "0"
      }).toString()
    });
  }

  private sendQuickSms(
    baseUrl: string,
    apiKey: string,
    input: SendOtpInput,
    signal: AbortSignal
  ) {
    return fetch(`${baseUrl}/dev/bulkV2`, {
      method: "POST",
      signal,
      headers: {
        accept: "application/json",
        authorization: apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        route: "q",
        message: this.quickSmsMessage(input.otp, input.otpExpiryMinutes),
        schedule_time: "",
        flash: 0,
        numbers: input.mobile
      })
    });
  }

  private dltVariables(otp: string) {
    return this.config.get<string>("FAST2SMS_DLT_VARIABLES_TEMPLATE", "{otp}").replaceAll("{otp}", otp);
  }

  private quickSmsMessage(otp: string, minutes: number) {
    return this.config
      .get<string>(
        "FAST2SMS_QUICK_SMS_TEMPLATE",
        "Your Lotzi verification code is {otp}. It expires in {minutes} minutes."
      )
      .replaceAll("{otp}", otp)
      .replaceAll("{minutes}", String(minutes));
  }

  private assertCircuitAllowsRequest() {
    if (this.circuitState !== "open") {
      return;
    }
    if (Date.now() < this.circuitOpenedUntil) {
      this.observability.setPhoneOtpCircuitState("FAST2SMS", this.circuitState);
      throw new OtpProviderError("Fast2SMS circuit is open.", "OTP_PROVIDER_CIRCUIT_OPEN", true);
    }
    this.circuitState = "half_open";
    this.observability.setPhoneOtpCircuitState("FAST2SMS", this.circuitState);
  }

  private recordSuccess() {
    this.failures = 0;
    this.circuitState = "closed";
    this.observability.setPhoneOtpCircuitState("FAST2SMS", this.circuitState);
  }

  private recordFailure() {
    this.failures += 1;
    const threshold = this.config.get<number>("FAST2SMS_CIRCUIT_FAILURE_THRESHOLD", 5);
    if (this.failures >= threshold) {
      this.circuitState = "open";
      this.circuitOpenedUntil = Date.now() + this.config.get<number>("FAST2SMS_CIRCUIT_OPEN_MS", 60_000);
      this.logger.error("Fast2SMS circuit opened after repeated OTP provider failures.");
    }
    this.observability.setPhoneOtpCircuitState("FAST2SMS", this.circuitState);
  }

  private mapProviderFailure(status: number, body: unknown) {
    const message = providerMessage(body);
    const normalized = message.toLowerCase();
    if (status === 401 || normalized.includes("authorization") || normalized.includes("api key")) {
      return new OtpProviderError("Fast2SMS authorization failed.", "OTP_PROVIDER_AUTH_FAILED", false);
    }
    if (isAccountNotReadyMessage(normalized)) {
      return new OtpProviderError(
        accountNotReadyMessage(normalized),
        "OTP_PROVIDER_ACCOUNT_NOT_READY",
        false
      );
    }
    if (normalized.includes("wallet") || normalized.includes("balance")) {
      return new OtpProviderError(`Fast2SMS wallet balance is insufficient. ${message}`, "OTP_PROVIDER_BALANCE_LOW", false);
    }
    if (normalized.includes("kyc")) {
      return new OtpProviderError(
        `Fast2SMS KYC is required before OTP SMS can be sent. ${message}`,
        "OTP_PROVIDER_ACCOUNT_NOT_READY",
        false
      );
    }
    if (normalized.includes("template") || normalized.includes("otp_id")) {
      return new OtpProviderError(`Fast2SMS OTP template is invalid. ${message}`, "OTP_PROVIDER_TEMPLATE_INVALID", false);
    }
    return new OtpProviderError(`Fast2SMS rejected the OTP request. ${message}`, "OTP_PROVIDER_REJECTED", status >= 500);
  }
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

function stringFromBody(body: unknown, key: string): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const value = (body as Record<string, unknown>)[key];
  if (Array.isArray(value)) {
    const text = value
      .filter((item) => ["string", "number", "boolean"].includes(typeof item))
      .map(String)
      .join(", ");
    return text || undefined;
  }
  if (["string", "number", "boolean"].includes(typeof value)) {
    return String(value);
  }
  return undefined;
}

function truncateProviderStatus(value: string): string {
  return value.length > 500 ? `${value.slice(0, 497)}...` : value;
}

function providerReturnedFailure(body: unknown) {
  if (!body || typeof body !== "object") {
    return false;
  }
  const record = body as Record<string, unknown>;
  return record.return === false || record.status === false || record.success === false;
}

function providerMessage(body: unknown) {
  return (
    stringFromBody(body, "message") ??
    stringFromBody(body, "error") ??
    stringFromBody(body, "reason") ??
    stringFromBody(body, "description") ??
    "Provider rejected request."
  );
}

function shouldTryBulkV2FormFallback(status: number, body: unknown) {
  if (status >= 500) {
    return false;
  }

  const normalized = providerMessage(body).toLowerCase();
  return !(
    normalized.includes("authorization") ||
    normalized.includes("api key") ||
    isAccountNotReadyMessage(normalized) ||
    normalized.includes("wallet") ||
    normalized.includes("balance") ||
    normalized.includes("kyc") ||
    normalized.includes("blocked")
  );
}

function isAccountNotReadyMessage(normalizedMessage: string) {
  return (
    normalizedMessage.includes("transaction of 100") ||
    normalizedMessage.includes("before using api route") ||
    normalizedMessage.includes("website verification") ||
    normalizedMessage.includes("otp message menu") ||
    normalizedMessage.includes("before using otp message api") ||
    normalizedMessage.includes("before using otp sms api") ||
    normalizedMessage.includes("complete kyc") ||
    normalizedMessage.includes("use dlt sms api")
  );
}

function accountNotReadyMessage(normalizedMessage: string) {
  if (normalizedMessage.includes("transaction of 100") || normalizedMessage.includes("before using api route")) {
    return "Fast2SMS API access is not enabled yet. Fast2SMS requires one recharge transaction of INR 100 or more before API routes can be used.";
  }
  return "Fast2SMS OTP API is not enabled for this account. Complete website verification in the Fast2SMS OTP Message menu, or configure an approved SMS route.";
}
