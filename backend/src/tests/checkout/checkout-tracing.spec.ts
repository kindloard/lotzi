import {
  checkoutTraceConfigFromEnv,
  checkoutTraceSnapshot,
  createCheckoutTraceContext,
  flushCheckoutTrace,
  recordCheckoutQueryTrace,
  runCheckoutTraceContext,
  sanitizeQueryFingerprint
} from "../../modules/checkout/checkout-tracing";

describe("checkout tracing", () => {
  it("rejects invalid sample-rate config", () => {
    expect(() => checkoutTraceConfigFromEnv({ CHECKOUT_TRACE_SAMPLE_RATE: "1.2" })).toThrow(
      /decimal fraction/
    );
    expect(() => checkoutTraceConfigFromEnv({
      NODE_ENV: "production",
      CHECKOUT_TRACE_SAMPLE_RATE: "0.5"
    })).toThrow(/production/);
  });

  it("allows high production sample only with explicit override", () => {
    const config = checkoutTraceConfigFromEnv({
      NODE_ENV: "production",
      CHECKOUT_TRACE_SAMPLE_RATE: "0.5",
      CHECKOUT_TRACE_ALLOW_HIGH_PROD_SAMPLE: "true"
    });
    expect(config.sampleRate).toBe(0.5);
  });

  it("sanitizes query fingerprints without raw values", () => {
    const fingerprint = sanitizeQueryFingerprint(
      "SELECT * FROM users WHERE email = 'customer@example.test' AND id = 123 AND token = $1"
    );
    expect(fingerprint).not.toContain("customer@example.test");
    expect(fingerprint).not.toContain("123");
    expect(fingerprint).not.toContain("$1");
    expect(fingerprint).toContain("email = ?");
  });

  it("caps query traces and marks cap hits", async () => {
    const context = createCheckoutTraceContext({
      requestId: "req-1",
      userId: "user-1",
      config: {
        enabled: true,
        sampleRate: 1,
        queryTraceEnabled: true,
        maxQueriesPerRequest: 1,
        maxBytesPerRequest: 32_768,
        allowHighProductionSample: false,
        nodeEnv: "test"
      }
    });

    await runCheckoutTraceContext(context, async () => {
      recordCheckoutQueryTrace({ duration: 2, query: "SELECT 1" });
      recordCheckoutQueryTrace({ duration: 3, query: "SELECT 2" });
      const snapshot = checkoutTraceSnapshot([{ stage: "total", durationMs: 5 }]);
      expect(snapshot?.queryCount).toBe(1);
      expect(snapshot?.queryCapReached).toBe(true);
    });
  });

  it("keeps trace emitter failures off the checkout path", async () => {
    const context = createCheckoutTraceContext({
      requestId: "req-2",
      config: {
        enabled: true,
        sampleRate: 1,
        queryTraceEnabled: false,
        maxQueriesPerRequest: 40,
        maxBytesPerRequest: 32_768,
        allowHighProductionSample: false,
        nodeEnv: "test"
      }
    });

    await expect(
      runCheckoutTraceContext(context, async () => {
        const flushed = flushCheckoutTrace([{ stage: "total", durationMs: 1 }], {
          log: () => {
            throw new Error("logger down");
          },
          warn: () => {
            throw new Error("logger down");
          }
        });
        expect(flushed?.requestId).toBe("req-2");
      })
    ).resolves.toBeUndefined();
  });
});
