export const DEFAULT_BUSINESS_HOURS = {
  monday: "9:00 AM - 6:00 PM",
  tuesday: "9:00 AM - 6:00 PM",
  wednesday: "9:00 AM - 6:00 PM",
  thursday: "9:00 AM - 6:00 PM",
  friday: "9:00 AM - 6:00 PM",
  saturday: "10:00 AM - 4:00 PM",
  sunday: "closed"
};

export function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function roundCoordinate(value: number) {
  return Math.round(value * 1e7) / 1e7;
}

export function coordinateText(value: unknown) {
  const number = numberValue(value);
  return number === undefined ? "--" : number.toFixed(7);
}

export function normalizeBusinessHours(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).map(([day, hours]) => [day, normalizeBusinessHourText(hours)])
  );
}

export function normalizeBusinessHourText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  const range = trimmed.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!range) {
    return trimmed;
  }

  return `${toTwelveHour(Number(range[1]), range[2])} - ${toTwelveHour(Number(range[3]), range[4])}`;
}

export function toTwelveHour(hour: number, minute: string) {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${period}`;
}
