import type { Metadata } from "next";
import { ProductsScreen } from "@/features/merchant-dashboard/screens/products/products-screen";

export const metadata: Metadata = {
  title: "Products | Lotzi",
  description: "Manage merchant products in Lotzi."
};

export default function MerchantProductsPage() {
  return <ProductsScreen />;
}
