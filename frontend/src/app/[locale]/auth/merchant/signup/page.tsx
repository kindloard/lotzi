import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MerchantSignupScreen } from "@/components/auth/merchant-signup-screen";
import type { AppLocale } from "@/i18n/routing";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as AppLocale, namespace: "metadata.auth.merchantSignup" });
  return {
    description: t("description"),
    title: t("title")
  };
}

export default function MerchantSignupPage() {
  return <MerchantSignupScreen />;
}
