import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

export const INR = "INR";
export const GST_BASIS_POINTS = 0;

export interface MoneyBreakdown {
  subtotalPaise: bigint;
  discountPaise: bigint;
  taxPaise: bigint;
  deliveryFeePaise: bigint;
  grandTotalPaise: bigint;
}

export function decimalRupeesToPaise(value: Prisma.Decimal | number | string): bigint {
  const decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  return BigInt(decimal.mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toString());
}

export function paiseToRupeeDecimal(value: bigint | number): Prisma.Decimal {
  return new Prisma.Decimal(value.toString()).div(100).toDecimalPlaces(2);
}

export function paiseToCashfreeAmount(value: bigint): string {
  return new Prisma.Decimal(value.toString()).div(100).toFixed(2);
}

export function paiseToNumber(value: bigint | number): number {
  return Number(value) / 100;
}

export function percentBasisPoints(value: bigint, basisPoints: number): bigint {
  return roundHalfUp(value * BigInt(basisPoints), 10_000n);
}

export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error("Denominator must be positive.");
  }
  return (numerator + denominator / 2n) / denominator;
}

export function quoteHash(payload: unknown): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

export function stableJson(input: unknown): string {
  return JSON.stringify(sortJson(input));
}

export function bigintJson(value: bigint): string {
  return value.toString();
}

function sortJson(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortJson(item)])
    );
  }
  return value;
}
