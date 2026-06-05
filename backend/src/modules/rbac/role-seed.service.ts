import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { RoleScope } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { PERMISSIONS, ROLE_CODES } from "./permissions";

const systemPermissions = [
  { code: PERMISSIONS.PROFILE_READ, description: "Read own profile.", scope: RoleScope.PLATFORM },
  { code: PERMISSIONS.PROFILE_WRITE, description: "Update own profile.", scope: RoleScope.PLATFORM },
  { code: PERMISSIONS.CART_WRITE, description: "Manage own cart.", scope: RoleScope.PLATFORM },
  { code: PERMISSIONS.ORDER_CREATE, description: "Create customer orders.", scope: RoleScope.PLATFORM },
  { code: PERMISSIONS.ORDER_READ_OWN, description: "Read own customer orders.", scope: RoleScope.PLATFORM },
  { code: PERMISSIONS.ADMIN_USERS, description: "Manage platform users.", scope: RoleScope.PLATFORM },
  { code: PERMISSIONS.ADMIN_STORES, description: "Manage platform stores.", scope: RoleScope.PLATFORM },
  { code: PERMISSIONS.ADMIN_ORDERS, description: "Manage platform orders.", scope: RoleScope.PLATFORM },
  { code: PERMISSIONS.ADMIN_SYSTEM, description: "Manage internal platform settings.", scope: RoleScope.PLATFORM },
  { code: PERMISSIONS.STORE_READ, description: "Read assigned store data.", scope: RoleScope.STORE },
  { code: PERMISSIONS.STORE_MANAGE, description: "Manage assigned store settings.", scope: RoleScope.STORE },
  { code: PERMISSIONS.STORE_STAFF_MANAGE, description: "Manage staff for assigned store.", scope: RoleScope.STORE },
  { code: PERMISSIONS.PRODUCT_MANAGE, description: "Manage products for assigned store.", scope: RoleScope.STORE },
  { code: PERMISSIONS.ORDER_MANAGE_STORE, description: "Manage orders for assigned store.", scope: RoleScope.STORE },
  { code: PERMISSIONS.UPLOAD_STORE, description: "Upload assets for assigned store.", scope: RoleScope.STORE }
] as const;

const systemRoles = [
  {
    code: ROLE_CODES.PLATFORM_SUPER_ADMIN,
    name: "Platform Super Admin",
    description: "Full platform administration access.",
    scope: RoleScope.PLATFORM,
    permissions: Object.values(PERMISSIONS)
  },
  {
    code: ROLE_CODES.CUSTOMER,
    name: "Customer",
    description: "Default buyer permissions.",
    scope: RoleScope.PLATFORM,
    permissions: [
      PERMISSIONS.PROFILE_READ,
      PERMISSIONS.PROFILE_WRITE,
      PERMISSIONS.CART_WRITE,
      PERMISSIONS.ORDER_CREATE,
      PERMISSIONS.ORDER_READ_OWN
    ]
  },
  {
    code: ROLE_CODES.MERCHANT_OWNER,
    name: "Merchant Owner",
    description: "Store owner with full store administration access.",
    scope: RoleScope.STORE,
    permissions: [
      PERMISSIONS.STORE_READ,
      PERMISSIONS.STORE_MANAGE,
      PERMISSIONS.STORE_STAFF_MANAGE,
      PERMISSIONS.PRODUCT_MANAGE,
      PERMISSIONS.ORDER_MANAGE_STORE,
      PERMISSIONS.UPLOAD_STORE
    ]
  },
  {
    code: ROLE_CODES.STORE_MANAGER,
    name: "Store Manager",
    description: "Store staff manager with operational access.",
    scope: RoleScope.STORE,
    permissions: [
      PERMISSIONS.STORE_READ,
      PERMISSIONS.STORE_MANAGE,
      PERMISSIONS.PRODUCT_MANAGE,
      PERMISSIONS.ORDER_MANAGE_STORE,
      PERMISSIONS.UPLOAD_STORE
    ]
  },
  {
    code: ROLE_CODES.STORE_STAFF,
    name: "Store Staff",
    description: "Store staff with limited order and catalog access.",
    scope: RoleScope.STORE,
    permissions: [
      PERMISSIONS.STORE_READ,
      PERMISSIONS.PRODUCT_MANAGE,
      PERMISSIONS.ORDER_MANAGE_STORE,
      PERMISSIONS.UPLOAD_STORE
    ]
  }
] as const;

@Injectable()
export class RoleSeedService implements OnModuleInit {
  private readonly logger = new Logger(RoleSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.seed();
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === maxRetries) {
          this.logger.error(
            `RBAC seed failed after ${maxRetries} attempts — app will start without seeded roles: ${message}`
          );
          return;
        }
        const delayMs = 1000 * 2 ** (attempt - 1);
        this.logger.warn(
          `RBAC seed attempt ${attempt}/${maxRetries} failed, retrying in ${delayMs}ms — ${message}`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  async seed() {
    const start = Date.now();

    await this.prisma.$transaction(async (tx) => {
      // Phase 1: Upsert all permissions in parallel
      await Promise.all(
        systemPermissions.map((permission) =>
          tx.permission.upsert({
            where: { code: permission.code },
            update: {
              description: permission.description,
              scope: permission.scope
            },
            create: permission
          })
        )
      );

      // Phase 2: Upsert all roles in parallel
      const savedRoles = await Promise.all(
        systemRoles.map((role) =>
          tx.role.upsert({
            where: { code: role.code },
            update: {
              name: role.name,
              description: role.description,
              scope: role.scope,
              isSystem: true
            },
            create: {
              code: role.code,
              name: role.name,
              description: role.description,
              scope: role.scope,
              isSystem: true
            }
          })
        )
      );

      // Phase 3: Wire role → permission mappings in parallel
      const allPermissions = await tx.permission.findMany({
        select: { id: true, code: true }
      });
      const permissionCodeToId = new Map(
        allPermissions.map((p) => [p.code, p.id])
      );

      const rolePermissionUpserts = savedRoles.flatMap((savedRole, index) => {
        const roleDef = systemRoles[index];
        return [...roleDef.permissions]
          .map((code) => permissionCodeToId.get(code))
          .filter((id): id is string => id !== undefined)
          .map((permissionId) =>
            tx.rolePermission.upsert({
              where: {
                roleId_permissionId: {
                  roleId: savedRole.id,
                  permissionId
                }
              },
              update: {},
              create: {
                roleId: savedRole.id,
                permissionId
              }
            })
          );
      });

      await Promise.all(rolePermissionUpserts);
    }, {
      timeout: 120_000, // 2 minutes to allow for high latency bulk upserts
      maxWait: 15_000
    });

    this.logger.log(
      `System RBAC roles and permissions are ready (${Date.now() - start}ms)`
    );
  }
}
