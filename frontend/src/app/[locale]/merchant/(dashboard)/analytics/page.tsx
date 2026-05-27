import type { Metadata } from "next";
import { AnalyticsScreen } from "@/features/merchant-dashboard/screens/analytics/analytics-screen";

export const metadata: Metadata = {
  title: "Analytics | Namastore",
  description: "Review merchant analytics in Namastore."
};

export default function MerchantAnalyticsPage() {
  return <AnalyticsScreen />;
}
