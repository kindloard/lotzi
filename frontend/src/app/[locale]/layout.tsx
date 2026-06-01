import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Geist_Mono, Noto_Sans_Tamil, Sora } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { IntlClientBridge } from "@/components/i18n/intl-client-bridge";
import { directionForLocale } from "@/i18n/locale-meta";
import { getLocaleFallbackKeys, loadMessages } from "@/i18n/messages";
import { routing, type AppLocale } from "@/i18n/routing";
import "../globals.css";

const appSans = Sora({
  adjustFontFallback: true,
  display: "swap",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-app-sans"
});

const appMono = Geist_Mono({
  adjustFontFallback: true,
  display: "swap",
  subsets: ["latin"],
  variable: "--font-app-mono"
});

const tamilFont = Noto_Sans_Tamil({
  adjustFontFallback: true,
  display: "swap",
  subsets: ["tamil"],
  variable: "--font-tamil"
});

type LocaleLayoutProps = Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Pick<LocaleLayoutProps, "params">): Promise<Metadata> {
  const { locale } = await params;
  const safeLocale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safeLocale, namespace: "metadata.root" });

  return {
    alternates: {
      canonical: `/${safeLocale}`,
      languages: {
        en: "/en",
        ta: "/ta",
        "x-default": "/en"
      }
    },
    description: t("description"),
    title: t("title")
  };
}

export default async function RootLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const appLocale = locale as AppLocale;
  setRequestLocale(appLocale);
  const messages = await loadMessages(appLocale);
  const fallbackKeys = await getLocaleFallbackKeys(appLocale);

  return (
    <html
      dir={directionForLocale(appLocale)}
      lang={appLocale}
      className={`${appSans.variable} ${appMono.variable} ${tamilFont.variable}`}
    >
      <body className="antialiased">
        <IntlClientBridge fallbackKeys={fallbackKeys} locale={appLocale} messages={messages}>
          <AppShell>{children}</AppShell>
        </IntlClientBridge>
      </body>
    </html>
  );
}
