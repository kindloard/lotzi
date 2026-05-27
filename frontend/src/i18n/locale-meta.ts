import type { AppLocale } from "./routing";

export type TextDirection = "ltr" | "rtl";

export const localeMeta: Record<AppLocale, { dir: TextDirection; label: string; nativeLabel: string }> = {
  en: {
    dir: "ltr",
    label: "English",
    nativeLabel: "English"
  },
  ta: {
    dir: "ltr",
    label: "Tamil",
    nativeLabel: "தமிழ்"
  }
};

export const futureRtlLocales = ["ar", "he", "fa", "ur"] as const;

export function directionForLocale(locale: AppLocale): TextDirection {
  return localeMeta[locale]?.dir ?? "ltr";
}

