import type { Metadata } from "next";
import { ProfileScreen } from "@/features/customer-account/screens/profile-screen";

export const metadata: Metadata = {
  title: "Profile | Namastore Account",
  description: "Manage your Namastore profile details.",
  robots: {
    follow: false,
    index: false
  }
};

export default function AccountProfilePage() {
  return <ProfileScreen />;
}
