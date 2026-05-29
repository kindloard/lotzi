import { Prisma } from "@prisma/client";
import { decimalRupeesToPaise, paiseToCashfreeAmount, percentBasisPoints } from "../../modules/payments/money";

describe("payment money helpers", () => {
  it("stores rupee decimals as integer paise with half-up rounding", () => {
    expect(decimalRupeesToPaise(new Prisma.Decimal("10.235"))).toBe(1024n);
    expect(decimalRupeesToPaise(new Prisma.Decimal("10.234"))).toBe(1023n);
  });

  it("formats Cashfree amounts with exactly two decimals", () => {
    expect(paiseToCashfreeAmount(123456n)).toBe("1234.56");
    expect(paiseToCashfreeAmount(1n)).toBe("0.01");
  });

  it("calculates basis point taxes in paise", () => {
    expect(percentBasisPoints(10_000n, 1_800)).toBe(1_800n);
    expect(percentBasisPoints(99n, 1_800)).toBe(18n);
  });
});
