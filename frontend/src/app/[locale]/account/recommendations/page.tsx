import type { Metadata } from "next";
import { RecommendationsScreen } from "@/features/customer-account/screens/placeholder-screen";

export const metadata: Metadata = {
  title: "Recommendations | Namastore Account",
  description: "View personalized Namastore recommendations.",
  robots: {
    follow: false,
    index: false
  }
};

export default function AccountRecommendationsPage() {
  return <RecommendationsScreen />;
}
