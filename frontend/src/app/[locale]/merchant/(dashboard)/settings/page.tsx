import type { Metadata } from "next";
import { SettingsScreen } from "@/features/merchant-dashboard/screens/settings/settings-screen";

export const metadata: Metadata = {
  title: "Settings | Lotzi",
  description: "Manage merchant settings in Lotzi."
};

export default function MerchantSettingsPage() {
  return <SettingsScreen />;
}
