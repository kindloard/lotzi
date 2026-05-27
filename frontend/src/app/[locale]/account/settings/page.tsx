import type { Metadata } from "next";
import { SettingsScreen } from "@/features/customer-account/screens/settings-screen";

export const metadata: Metadata = {
  title: "Settings | Namastore Account",
  description: "Manage Namastore account preferences and notification settings.",
  robots: {
    follow: false,
    index: false
  }
};

export default function AccountSettingsPage() {
  return <SettingsScreen />;
}
