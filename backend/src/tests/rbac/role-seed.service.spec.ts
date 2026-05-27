import { describe, expect, it, jest } from "@jest/globals";
import { RoleScope } from "@prisma/client";
import { ROLE_CODES } from "../../modules/rbac/permissions";
import { RoleSeedService } from "../../modules/rbac/role-seed.service";

describe("RoleSeedService", () => {
  it("upserts required system RBAC rows", async () => {
    const prisma = {
      permission: {
        upsert: jest.fn(async ({ create }) => ({ id: `permission-${create.code}`, ...create })),
        findMany: jest.fn(async () => [{ id: "permission-1" }])
      },
      role: {
        upsert: jest.fn(async ({ create }) => ({ id: `role-${create.code}`, ...create }))
      },
      rolePermission: {
        upsert: jest.fn(async () => ({}))
      }
    };
    const service = new RoleSeedService(prisma as never);

    await service.seed();

    expect(prisma.role.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: ROLE_CODES.CUSTOMER },
        create: expect.objectContaining({
          code: ROLE_CODES.CUSTOMER,
          scope: RoleScope.PLATFORM,
          isSystem: true
        })
      })
    );
    expect(prisma.role.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: ROLE_CODES.MERCHANT_OWNER },
        create: expect.objectContaining({
          code: ROLE_CODES.MERCHANT_OWNER,
          scope: RoleScope.STORE,
          isSystem: true
        })
      })
    );
    expect(prisma.rolePermission.upsert).toHaveBeenCalled();
  });
});
