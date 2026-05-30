export interface SendOtpInput {
  mobile: string;
  otp: string;
  otpExpiryMinutes: number;
  requestId: string;
}

export interface SendOtpResult {
  accepted: boolean;
  providerMessageId?: string;
  rawStatus?: string;
}

export interface OtpProvider {
  readonly name: "FAST2SMS";
  sendOtp(input: SendOtpInput): Promise<SendOtpResult>;
}

export class OtpProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "OTP_PROVIDER_AUTH_FAILED"
      | "OTP_PROVIDER_ACCOUNT_NOT_READY"
      | "OTP_PROVIDER_BALANCE_LOW"
      | "OTP_PROVIDER_TEMPLATE_INVALID"
      | "OTP_PROVIDER_TIMEOUT"
      | "OTP_PROVIDER_CIRCUIT_OPEN"
      | "OTP_PROVIDER_UNAVAILABLE"
      | "OTP_PROVIDER_REJECTED",
    readonly retryable: boolean
  ) {
    super(message);
  }
}
