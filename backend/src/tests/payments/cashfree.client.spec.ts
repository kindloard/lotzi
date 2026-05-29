import { createHmac } from "node:crypto";
import { CashfreeClient } from "../../integrations/cashfree/cashfree.client";

describe("CashfreeClient webhook verification", () => {
  it("validates Cashfree timestamp plus raw-body signatures", () => {
    const secret = "test_cashfree_secret";
    const client = new CashfreeClient({
      get: (key: string, fallback?: string) => {
        if (key === "CASHFREE_WEBHOOK_SECRET") return secret;
        return fallback;
      }
    } as never);
    const rawBody = Buffer.from(JSON.stringify({ type: "PAYMENT_SUCCESS", data: { order: { order_id: "nma_1" } } }));
    const timestamp = "1760000000";
    const signature = createHmac("sha256", secret)
      .update(Buffer.concat([Buffer.from(timestamp), rawBody]))
      .digest("base64");

    expect(client.verifyWebhookSignature({ rawBody, timestamp, signature })).toBe(true);
    expect(client.verifyWebhookSignature({ rawBody, timestamp, signature: `${signature}x` })).toBe(false);
  });
});
