import type { Metadata } from "next";
import { PaymentsScreen } from "@/features/merchant-dashboard/screens/payments/payments-screen";

export const metadata: Metadata = {
  title: "Payments | Lotzi",
  description: "Review merchant payments in Lotzi."
};

export default function MerchantPaymentsPage() {
  return <PaymentsScreen />;
}
