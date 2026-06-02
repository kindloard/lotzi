import type { Metadata } from "next";
import { AdminMerchantApprovalsScreen } from "@/features/admin/merchant-approvals/admin-merchant-approvals-screen";

export const metadata: Metadata = {
  title: "Merchant approvals | Lotzi admin",
  description: "Approve submitted Lotzi merchant applications."
};

export default function AdminMerchantApprovalsPage() {
  return <AdminMerchantApprovalsScreen />;
}
