import type { Metadata } from "next";
import { ProfileScreen } from "@/features/customer-account/screens/profile-screen";

export const metadata: Metadata = {
  title: "Profile | Lotzi Account",
  description: "Manage your Lotzi profile details.",
  robots: {
    follow: false,
    index: false
  }
};

export default function AccountProfilePage() {
  return <ProfileScreen />;
}
