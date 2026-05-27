import type { useFormatter } from "next-intl";
import { ApiError } from "@/lib/api";

export function initialsFor(name: string | null | undefined, email: string | null | undefined) {
  const source = name?.trim() || email || "User";
  return (
    source
      .split(/\s+|@/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U"
  );
}

export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

export function currency(formatter: ReturnType<typeof useFormatter>, value: number) {
  return formatter.number(value, {
    currency: "INR",
    maximumFractionDigits: 0,
    style: "currency"
  });
}

export function formatDate(formatter: ReturnType<typeof useFormatter>, value: string) {
  return formatter.dateTime(new Date(value), {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

export function formatIndianPhoneNumber(value: string): string {
  if (!value) return "";

  if (value === "+91" || value === "+91 " || value === "+" || value === "+9") {
    return "";
  }

  let digits = value.replace(/\D/g, "");

  if (value.startsWith("+91")) {
    digits = digits.replace(/^91/, "");
  } else if (digits.length >= 12 && digits.startsWith("91")) {
    digits = digits.substring(2);
  } else if (digits.length >= 11 && digits.startsWith("0")) {
    digits = digits.substring(1);
  }

  if (!digits) {
    return "";
  }

  digits = digits.substring(0, 10);

  if (digits.length > 5) {
    return `+91 ${digits.substring(0, 5)} ${digits.substring(5)}`;
  }

  return `+91 ${digits}`;
}

export function isValidIndianPhoneNumber(value: string | null | undefined): boolean {
  if (!value) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length === 12 && digits.startsWith("91");
}
