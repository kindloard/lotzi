"use client";

import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api";

export type ApiErrorBody = {
  code?: string;
  message?: string;
  params?: Record<string, number | string>;
  fieldErrors?: Array<{
    path: string;
    code: string;
    message?: string;
    params?: Record<string, number | string>;
  }>;
};

export function useApiErrorTranslator() {
  const t = useTranslations("errors");
  const translate = t as unknown as {
    (key: string, values?: Record<string, number | string>): string;
    has: (key: string) => boolean;
  };

  return (error: unknown, fallbackCode = "GENERIC") => {
    const body = apiErrorBody(error);
    const code = body?.code || fallbackCode;
    const params = body?.params ?? {};

    if (translate.has(code)) {
      return translate(code, params);
    }

    return body?.message || translate(fallbackCode);
  };
}

export function apiErrorBody(error: unknown): ApiErrorBody | null {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== "object") {
    return null;
  }
  return error.body as ApiErrorBody;
}
