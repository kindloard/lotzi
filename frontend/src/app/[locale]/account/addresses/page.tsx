import type { Metadata } from "next";
import { AddressesScreen } from "@/features/customer-account/screens/addresses-screen";

export const metadata: Metadata = {
  title: "Addresses | Lotzi Account",
  description: "Manage your Lotzi delivery addresses.",
  robots: {
    follow: false,
    index: false
  }
};

export default function AccountAddressesPage() {
  return <AddressesScreen />;
}
