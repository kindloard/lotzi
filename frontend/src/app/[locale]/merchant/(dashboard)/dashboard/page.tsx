import type { Metadata } from "next";
import { OverviewScreen } from "@/features/merchant-dashboard/screens/overview/overview-screen";

export const metadata: Metadata = {
  title: "Merchant dashboard | Namastore",
  description: "Run your Namastore merchant business from one premium operating dashboard."
};

export default function MerchantDashboardPage() {
  return <OverviewScreen />;
}
