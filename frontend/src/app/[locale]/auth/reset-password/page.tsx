import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import type { AppLocale } from "@/i18n/routing";
import { ResetPasswordForm } from "./reset-password-form";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as AppLocale, namespace: "metadata.auth.resetPassword" });
  return {
    description: t("description"),
    title: t("title")
  };
}

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
