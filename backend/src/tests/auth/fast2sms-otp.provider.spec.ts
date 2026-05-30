import { ConfigService } from "@nestjs/config";
import { ObservabilityService } from "../../modules/observability/observability.service";
import { Fast2SmsOtpProvider } from "../../modules/auth/fast2sms-otp.provider";
import { OtpProviderError } from "../../modules/auth/phone-otp.provider";

describe("Fast2SmsOtpProvider", () => {
  const config = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      const values: Record<string, unknown> = {
        FAST2SMS_API_KEY: "test-api-key",
        FAST2SMS_BASE_URL: "https://www.fast2sms.com",
        FAST2SMS_OTP_MODE: "BULKV2_OTP",
        FAST2SMS_QUICK_SMS_TEMPLATE: "Your Namastore verification code is {otp}. It expires in {minutes} minutes.",
        FAST2SMS_RETRY_COUNT: 0,
        FAST2SMS_TIMEOUT_MS: 5000
      };
      return values[key] ?? defaultValue;
    })
  } as unknown as ConfigService;

  const observability = {
    setPhoneOtpCircuitState: jest.fn()
  } as unknown as ObservabilityService;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  it("maps Fast2SMS website verification rejection to account-not-ready without retrying another request shape", async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          return: false,
          message:
            "Before using OTP Message API, complete website verification. Visit OTP Message menu or use DLT SMS API."
        }),
        { status: 400 }
      )
    );

    const provider = new Fast2SmsOtpProvider(config, observability);

    await expect(
      provider.sendOtp({
        mobile: "6383634873",
        otp: "123456",
        otpExpiryMinutes: 5,
        requestId: "request-1"
      })
    ).rejects.toMatchObject({
      code: "OTP_PROVIDER_ACCOUNT_NOT_READY",
      retryable: false
    } satisfies Partial<OtpProviderError>);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps Fast2SMS minimum transaction rejection to account-not-ready", async () => {
    const fetchMock = global.fetch as jest.Mock;
    (config.get as jest.Mock).mockImplementation((key: string, defaultValue?: unknown) => {
      const values: Record<string, unknown> = {
        FAST2SMS_API_KEY: "test-api-key",
        FAST2SMS_BASE_URL: "https://www.fast2sms.com",
        FAST2SMS_OTP_MODE: "QUICK_SMS",
        FAST2SMS_QUICK_SMS_TEMPLATE: "Your Namastore verification code is {otp}.",
        FAST2SMS_RETRY_COUNT: 0,
        FAST2SMS_TIMEOUT_MS: 5000
      };
      return values[key] ?? defaultValue;
    });
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          return: false,
          message: "You need to complete one transaction of 100 INR or more before using API route."
        }),
        { status: 400 }
      )
    );

    const provider = new Fast2SmsOtpProvider(config, observability);

    await expect(
      provider.sendOtp({
        mobile: "6383634873",
        otp: "123456",
        otpExpiryMinutes: 5,
        requestId: "request-1"
      })
    ).rejects.toMatchObject({
      code: "OTP_PROVIDER_ACCOUNT_NOT_READY",
      retryable: false
    } satisfies Partial<OtpProviderError>);
  });

  it("sends paid Quick SMS with route q when configured", async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          return: true,
          request_id: "quick-request-1",
          message: ["SMS sent successfully."]
        }),
        { status: 200 }
      )
    );
    (config.get as jest.Mock).mockImplementation((key: string, defaultValue?: unknown) => {
      const values: Record<string, unknown> = {
        FAST2SMS_API_KEY: "test-api-key",
        FAST2SMS_BASE_URL: "https://www.fast2sms.com",
        FAST2SMS_OTP_MODE: "QUICK_SMS",
        FAST2SMS_QUICK_SMS_TEMPLATE: "Your Namastore verification code is {otp}. It expires in {minutes} minutes.",
        FAST2SMS_RETRY_COUNT: 0,
        FAST2SMS_TIMEOUT_MS: 5000
      };
      return values[key] ?? defaultValue;
    });

    const provider = new Fast2SmsOtpProvider(config, observability);

    await expect(
      provider.sendOtp({
        mobile: "6383634873",
        otp: "123456",
        otpExpiryMinutes: 5,
        requestId: "request-1"
      })
    ).resolves.toMatchObject({
      accepted: true,
      providerMessageId: "quick-request-1",
      rawStatus: "SMS sent successfully."
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.fast2sms.com/dev/bulkV2",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          route: "q",
          message: "Your Namastore verification code is 123456. It expires in 5 minutes.",
          schedule_time: "",
          flash: 0,
          numbers: "6383634873"
        })
      })
    );
  });
});
