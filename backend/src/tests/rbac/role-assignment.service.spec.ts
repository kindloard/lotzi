import { SessionRevokedReason } from "@prisma/client";
import { RoleAssignmentService } from "../../modules/rbac/role-assignment.service";

describe("RoleAssignmentService", () => {
  it("assigns platform roles and revokes active sessions on explicit role changes", async () => {
    const tx = {
      userRoleAssignment: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: "assignment-1" }))
      },
      user: {
        update: jest.fn(async () => ({ authzVersion: 2 }))
      },
      session: {
        findMany: jest.fn(async () => [{ id: "session-1" }]),
        updateMany: jest.fn()
      }
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx))
    };
    const roles = {
      findRoleByCode: jest.fn(async () => ({ id: "role-1", code: "PLATFORM_SUPER_ADMIN" }))
    };
    const authStateInvalidator = {
      invalidateUserVersions: jest.fn(async () => undefined),
      invalidateSessions: jest.fn(async () => undefined)
    };
    const service = new RoleAssignmentService(
      prisma as never,
      roles as never,
      authStateInvalidator as never
    );

    await service.assignPlatformRole("user-1", "PLATFORM_SUPER_ADMIN", "admin-1");

    expect(tx.userRoleAssignment.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        roleId: "role-1",
        assignedById: "admin-1"
      }
    });
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revoked: false },
      data: {
        revoked: true,
        revokedAt: expect.any(Date),
        revokedReason: SessionRevokedReason.ROLE_CHANGED
      }
    });
    expect(authStateInvalidator.invalidateSessions).toHaveBeenCalledWith(["session-1"]);
    expect(authStateInvalidator.invalidateUserVersions).toHaveBeenCalledWith("user-1", [1, 2]);
  });
});
