import type { Metadata } from "next";
import { AddressesScreen } from "@/features/customer-account/screens/addresses-screen";

export const metadata: Metadata = {
  title: "Addresses | Namastore Account",
  description: "Manage your Namastore delivery addresses.",
  robots: {
    follow: false,
    index: false
  }
};

export default function AccountAddressesPage() {
  return <AddressesScreen />;
}
