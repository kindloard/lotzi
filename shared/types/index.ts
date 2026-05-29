export type PlatformRole = "PLATFORM_SUPER_ADMIN" | "CUSTOMER";
export type StoreRole = "MERCHANT_OWNER" | "STORE_MANAGER" | "STORE_STAFF";
export type RoleCode = PlatformRole | StoreRole;

export type PaymentMethod = "CASHFREE";

export type OrderStatus =
  | "PENDING"
  | "ACCEPTED"
  | "REJECTED"
  | "PACKING"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED";
