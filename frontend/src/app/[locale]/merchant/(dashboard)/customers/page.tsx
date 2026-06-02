import type { Metadata } from "next";
import { CustomersScreen } from "@/features/merchant-dashboard/screens/customers/customers-screen";

export const metadata: Metadata = {
  title: "Customers | Lotzi",
  description: "Manage merchant customers in Lotzi."
};

export default function MerchantCustomersPage() {
  return <CustomersScreen />;
}
