import type { Metadata } from "next";
import { RecommendationsScreen } from "@/features/customer-account/screens/placeholder-screen";

export const metadata: Metadata = {
  title: "Recommendations | Lotzi Account",
  description: "View personalized Lotzi recommendations.",
  robots: {
    follow: false,
    index: false
  }
};

export default function AccountRecommendationsPage() {
  return <RecommendationsScreen />;
}
