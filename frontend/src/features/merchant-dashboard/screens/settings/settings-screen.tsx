"use client";

import { Banknote, LockKeyhole, Store, Truck } from "lucide-react";
import { useTranslations } from "next-intl";
import { PageTitle, SettingsPanel } from "../../components/ui/dashboard-ui";

export function SettingsScreen() {
  const t = useTranslations("dashboard");
  return (
    <div className="space-y-6">
      <PageTitle eyebrow={t("settings.eyebrow")} title={t("settings.title")} />
      <section className="grid gap-6 xl:grid-cols-2">
        <SettingsPanel icon={Store} title={t("settings.storeProfile")} rows={[t("settings.rows.logoBanner"), t("settings.rows.publicStoreName"), t("settings.rows.businessDescription"), t("settings.rows.categoryVisibility")]} />
        <SettingsPanel icon={Banknote} title={t("settings.bankAndTax")} rows={[t("settings.rows.bankVerified"), t("settings.rows.gstinOnFile"), t("settings.rows.settlementSchedule"), t("settings.rows.invoicePreferences")]} />
        <SettingsPanel icon={Truck} title={t("settings.shippingAndReturns")} rows={[t("settings.rows.deliveryZones"), t("settings.rows.returnWindow"), t("settings.rows.cancellationPolicy"), t("settings.rows.packagingSla")]} />
        <SettingsPanel icon={LockKeyhole} title={t("settings.securityAndTeam")} rows={[t("settings.rows.ownerRoleActive"), t("settings.rows.twoStepSensitiveActions"), t("settings.rows.auditLogRetained"), t("settings.rows.sessionSecurity")]} />
      </section>
    </div>
  );
}

