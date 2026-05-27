export const ROLE_CODES = {
  PLATFORM_SUPER_ADMIN: "PLATFORM_SUPER_ADMIN",
  CUSTOMER: "CUSTOMER",
  MERCHANT_OWNER: "MERCHANT_OWNER",
  STORE_MANAGER: "STORE_MANAGER",
  STORE_STAFF: "STORE_STAFF"
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

export const PERMISSIONS = {
  PROFILE_READ: "profile:read",
  PROFILE_WRITE: "profile:write",
  CART_WRITE: "cart:write",
  ORDER_CREATE: "order:create",
  ORDER_READ_OWN: "order:read:own",
  ADMIN_USERS: "admin:users",
  ADMIN_STORES: "admin:stores",
  ADMIN_ORDERS: "admin:orders",
  ADMIN_SYSTEM: "admin:system",
  STORE_READ: "store:read",
  STORE_MANAGE: "store:manage",
  STORE_STAFF_MANAGE: "store:staff:manage",
  PRODUCT_MANAGE: "product:manage",
  ORDER_MANAGE_STORE: "order:manage:store",
  UPLOAD_STORE: "upload:store"
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const STORE_ROLE_CODES = new Set<string>([
  ROLE_CODES.MERCHANT_OWNER,
  ROLE_CODES.STORE_MANAGER,
  ROLE_CODES.STORE_STAFF
]);

export const PLATFORM_ADMIN_ROLE_CODES = new Set<string>([
  ROLE_CODES.PLATFORM_SUPER_ADMIN
]);
