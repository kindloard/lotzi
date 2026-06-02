import type { Metadata } from "next";
import { SecurityScreen } from "@/features/customer-account/screens/security-screen";

export const metadata: Metadata = {
  title: "Security | Lotzi Account",
  description: "Manage your password, email, active sessions, and account security.",
  robots: {
    follow: false,
    index: false
  }
};

export default function AccountSecurityPage() {
  return <SecurityScreen />;
}
