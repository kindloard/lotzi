import type { Metadata } from "next";
import { PaymentsScreen } from "@/features/customer-account/screens/placeholder-screen";

export const metadata: Metadata = {
  title: "Payments | Namastore Account",
  description: "Manage saved payment methods for Namastore checkout.",
  robots: {
    follow: false,
    index: false
  }
};

export default function AccountPaymentsPage() {
  return <PaymentsScreen />;
}
