import type { ReactNode } from "react";
import { MerchantDashboardShell } from "@/features/merchant-dashboard/providers/merchant-dashboard-shell";

export default function MerchantDashboardLayout({ children }: { children: ReactNode }) {
  return <MerchantDashboardShell>{children}</MerchantDashboardShell>;
}
