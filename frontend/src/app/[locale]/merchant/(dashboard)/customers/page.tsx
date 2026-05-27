import type { Metadata } from "next";
import { CustomersScreen } from "@/features/merchant-dashboard/screens/customers/customers-screen";

export const metadata: Metadata = {
  title: "Customers | Namastore",
  description: "Manage merchant customers in Namastore."
};

export default function MerchantCustomersPage() {
  return <CustomersScreen />;
}
