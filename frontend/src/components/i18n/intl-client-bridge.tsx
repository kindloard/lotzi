"use client";

import { ReactNode, useEffect } from "react";
import { NextIntlClientProvider } from "next-intl";
import { usePathname } from "next/navigation";
import { formats } from "@/i18n/formats";
import type { AppLocale } from "@/i18n/routing";
import { reportI18nFallback, routeTemplateForPathname } from "@/i18n/telemetry";

export function IntlClientBridge({
  children,
  fallbackKeys,
  locale,
  messages
}: {
  children: ReactNode;
  fallbackKeys: string[];
  locale: AppLocale;
  messages: Record<string, unknown>;
}) {
  const pathname = usePathname();
  const routeTemplate = routeTemplateForPathname(pathname);

  useEffect(() => {
    for (const fullKey of fallbackKeys) {
      const [namespace, ...rest] = fullKey.split(".");
      reportI18nFallback({
        locale,
        namespace: namespace || "unknown",
        key: rest.join(".") || fullKey,
        routeTemplate
      });
    }
  }, [fallbackKeys, locale, routeTemplate]);

  return (
    <NextIntlClientProvider
      formats={formats}
      getMessageFallback={({ namespace, key }) => {
        reportI18nFallback({
          locale,
          namespace: namespace ?? "unknown",
          key,
          routeTemplate
        });
        return process.env.NODE_ENV === "production" ? key : `${namespace ?? "messages"}.${key}`;
      }}
      locale={locale}
      messages={messages}
      onError={(error) => {
        if (process.env.NODE_ENV !== "production") {
          console.warn(error);
        }
      }}
      timeZone="Asia/Kolkata"
    >
      {children}
    </NextIntlClientProvider>
  );
}
