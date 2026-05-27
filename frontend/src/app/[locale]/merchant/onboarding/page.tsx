import type { Metadata } from "next";
import { MerchantOnboardingWizard } from "@/features/merchant-onboarding/merchant-onboarding-wizard";

export const metadata: Metadata = {
  title: "Merchant onboarding | Namastore",
  description: "Set up your Namastore merchant profile and prepare your store for launch."
};

export default function MerchantOnboardingPage() {
  return <MerchantOnboardingWizard />;
}
