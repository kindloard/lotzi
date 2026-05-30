import type { Metadata } from "next";
import { CheckoutPasswordScreen } from "./checkout-password-screen";

export const metadata: Metadata = {
  description: "Create a password to finish checkout.",
  robots: { index: false, follow: false },
  title: "Secure checkout account"
};

export default function CheckoutPasswordPage() {
  return <CheckoutPasswordScreen />;
}
