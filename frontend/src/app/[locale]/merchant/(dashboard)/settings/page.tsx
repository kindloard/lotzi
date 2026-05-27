import type { Metadata } from "next";
import { SettingsScreen } from "@/features/merchant-dashboard/screens/settings/settings-screen";

export const metadata: Metadata = {
  title: "Settings | Namastore",
  description: "Manage merchant settings in Namastore."
};

export default function MerchantSettingsPage() {
  return <SettingsScreen />;
}
