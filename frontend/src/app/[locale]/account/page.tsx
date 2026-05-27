import type { Metadata } from "next";
import { AccountHomeScreen } from "@/features/customer-account/screens/account-home-screen";

export const metadata: Metadata = {
  title: "Account | Namastore",
  description: "Manage your Namastore account, profile, addresses, orders, and security settings.",
  robots: {
    follow: false,
    index: false
  }
};

export default function AccountPage() {
  return <AccountHomeScreen />;
}
