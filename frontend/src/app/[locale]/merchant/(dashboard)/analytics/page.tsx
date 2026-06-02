import type { Metadata } from "next";
import { AnalyticsScreen } from "@/features/merchant-dashboard/screens/analytics/analytics-screen";

export const metadata: Metadata = {
  title: "Analytics | Lotzi",
  description: "Review merchant analytics in Lotzi."
};

export default function MerchantAnalyticsPage() {
  return <AnalyticsScreen />;
}
