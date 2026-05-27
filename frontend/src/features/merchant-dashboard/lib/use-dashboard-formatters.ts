"use client";

import { useFormatter } from "next-intl";

function formatCompactRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();

  if (Number.isNaN(timestamp)) {
    return "-";
  }

  const deltaMs = Date.now() - timestamp;
  const isFuture = deltaMs < 0;
  const absoluteMinutes = Math.max(0, Math.floor(Math.abs(deltaMs) / 60_000));

  if (absoluteMinutes < 1) {
    return "just now";
  }

  const units = [
    { limit: 60, divisor: 1, label: "min" },
    { limit: 24 * 60, divisor: 60, label: "hour" },
    { limit: 30 * 24 * 60, divisor: 24 * 60, label: "day" },
    { limit: 365 * 24 * 60, divisor: 30 * 24 * 60, label: "mo" },
    { limit: Number.POSITIVE_INFINITY, divisor: 365 * 24 * 60, label: "yr" }
  ];

  const unit = units.find((candidate) => absoluteMinutes < candidate.limit) ?? units[units.length - 1];
  const count = Math.max(1, Math.floor(absoluteMinutes / unit.divisor));
  const unitLabel = ["hour", "day"].includes(unit.label) && count !== 1 ? `${unit.label}s` : unit.label;
  const text = `${count} ${unitLabel}`;

  return isFuture ? `in ${text}` : `${text} ago`;
}

export function useDashboardFormatters() {
  const format = useFormatter();

  return {
    currency(value: number) {
      return format.number(value, "currency");
    },
    number(value: number) {
      return format.number(value, "integer");
    },
    dateTime(value: string) {
      return format.dateTime(new Date(value), "medium");
    },
    relativeDate(value: string) {
      return formatCompactRelativeTime(value);
    },
    percent(value: number) {
      return format.number(value / 100, "percent");
    }
  };
}
