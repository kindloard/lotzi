import { StoreStatus } from "@prisma/client";

export interface MerchantDashboardBootstrap {
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  };
  store: {
    id: string;
    name: string;
    slug: string;
    status: StoreStatus;
    logoUrl: string | null;
  };
  membership: {
    roleCode: string;
    roleName: string;
  };
}
