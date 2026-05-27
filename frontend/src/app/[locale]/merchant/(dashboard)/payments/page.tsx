import type { Metadata } from "next";
import { PaymentsScreen } from "@/features/merchant-dashboard/screens/payments/payments-screen";

export const metadata: Metadata = {
  title: "Payments | Namastore",
  description: "Review merchant payments in Namastore."
};

export default function MerchantPaymentsPage() {
  return <PaymentsScreen />;
}
