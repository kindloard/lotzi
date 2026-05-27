import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SignupScreen } from "@/components/auth/signup-screen";
import type { AppLocale } from "@/i18n/routing";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as AppLocale, namespace: "metadata.auth.signup" });
  return {
    description: t("description"),
    title: t("title")
  };
}

export default function SignupPage() {
  return <SignupScreen />;
}
