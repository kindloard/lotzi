import type { Metadata } from "next";
import { VerifyPhoneScreen } from "./verify-phone-screen";

export const metadata: Metadata = {
  description: "Verify your phone number to finish secure checkout.",
  robots: { index: false, follow: false },
  title: "Verify phone"
};

export default function VerifyPhonePage() {
  return <VerifyPhoneScreen />;
}
