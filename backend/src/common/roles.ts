export const PLATFORM_ROLES = ["PLATFORM_SUPER_ADMIN", "CUSTOMER"] as const;
export const STORE_ROLES = ["MERCHANT_OWNER", "STORE_MANAGER", "STORE_STAFF"] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export type StoreRole = (typeof STORE_ROLES)[number];
export type RoleCode = PlatformRole | StoreRole;
