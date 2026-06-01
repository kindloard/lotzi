import { createHash } from "node:crypto";
import { PhonepeClient } from "../../integrations/phonepe/phonepe.client";

describe("PhonepeClient", () => {
  it("extracts redirect URLs from supported response shapes", () => {
    const client = new PhonepeClient({ get: () => undefined } as never);

    expect(client.redirectUrlFromResponse({ redirectUrl: "https://phonepe.test/pay/1" })).toBe("https://phonepe.test/pay/1");
    expect(client.redirectUrlFromResponse({
      data: {
        instrumentResponse: {
          redirectInfo: {
            url: "https://phonepe.test/pay/2"
          }
        }
      }
    })).toBe("https://phonepe.test/pay/2");
  });

  it("validates legacy x-verify checksums without leaking timing differences", () => {
    const client = new PhonepeClient({ get: () => undefined } as never);
    const encodedResponse = Buffer.from(JSON.stringify({ merchantTransactionId: "nma_pp_test" })).toString("base64");
    const saltKey = "test_phonepe_salt";
    const saltIndex = "1";
    const xVerify = `${createHash("sha256").update(`${encodedResponse}${saltKey}`).digest("hex")}###${saltIndex}`;

    expect(client.validateLegacyXVerify({
      encodedResponse,
      xVerify,
      credentials: { saltKey, saltIndex }
    })).toBe(true);
    expect(client.validateLegacyXVerify({
      encodedResponse,
      xVerify: `${xVerify}x`,
      credentials: { saltKey, saltIndex }
    })).toBe(false);
  });
});
