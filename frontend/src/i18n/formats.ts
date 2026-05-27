import type { Formats } from "next-intl";

export const formats = {
  number: {
    integer: {
      maximumFractionDigits: 0
    },
    currency: {
      currency: "INR",
      maximumFractionDigits: 0,
      style: "currency"
    },
    percent: {
      maximumFractionDigits: 1,
      style: "percent"
    }
  },
  dateTime: {
    short: {
      day: "numeric",
      month: "short",
      year: "numeric"
    },
    medium: {
      dateStyle: "medium",
      timeStyle: "short"
    }
  }
} satisfies Formats;

