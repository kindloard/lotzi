import { Injectable } from "@nestjs/common";
import { Prisma, SessionRevokedReason, StoreMemberStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { ROLE_CODES } from "./permissions";
import { AuthStateInvalidator } from "./auth-state-invalidator.service";
import { RoleRepository } from "./repositories/role.repository";

@Injectable()
export class RoleAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roles: RoleRepository,
    private readonly authStateInvalidator: AuthStateInvalidator
  ) {}

  ensureCustomerRole(userId: string, tx?: Prisma.TransactionClient) {
    return this.ensurePlatformRole(userId, ROLE_CODES.CUSTOMER, undefined, tx);
  }

  async ensurePlatformRole(
    userId: string,
    roleCode: string,
    assignedByUserId?: string,
    tx: Prisma.TransactionClient = this.prisma,
    revokeSessions = false
  ) {
    const role = await this.roles.findRoleByCode(roleCode, tx);
    if (!role) {
      throw new Error(`Role ${roleCode} is not seeded.`);
    }

    const existing = await tx.userRoleAssignment.findFirst({
      where: {
        userId,
        roleId: role.id,
        revokedAt: null
      }
    });
    if (existing) {
      return existing;
    }

    const assignment = await tx.userRoleAssignment.create({
      data: {
        userId,
        roleId: role.id,
        assignedById: assignedByUserId
      }
    });
    await this.invalidateAuthorization(userId, tx, revokeSessions);
    return assignment;
  }

  async assignPlatformRole(
    userId: string,
    roleCode: string,
    assignedByUserId: string
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        return this.ensurePlatformRole(userId, roleCode, assignedByUserId, tx, true);
      },
      { maxWait: 10_000, timeout: 30_000 }
    );
  }

  async ensureStoreRole(
    input: {
      storeId: string;
      userId: string;
      roleCode: string;
      status?: StoreMemberStatus;
      invitedByUserId?: string;
      joinedAt?: Date | null;
    },
    tx: Prisma.TransactionClient = this.prisma
  ) {
    const role = await this.roles.findRoleByCode(input.roleCode, tx);
    if (!role) {
      throw new Error(`Role ${input.roleCode} is not seeded.`);
    }

    const existing = await tx.storeMember.findFirst({
      where: {
        storeId: input.storeId,
        userId: input.userId,
        status: { not: StoreMemberStatus.REMOVED }
      }
    });
    if (existing) {
      if (existing.roleId === role.id && existing.status === (input.status ?? existing.status)) {
        return existing;
      }
      const updated = await tx.storeMember.update({
        where: { id: existing.id },
        data: {
          roleId: role.id,
          status: input.status ?? existing.status,
          invitedByUserId: input.invitedByUserId ?? existing.invitedByUserId,
          joinedAt: input.joinedAt === undefined ? existing.joinedAt : input.joinedAt
        }
      });
      await this.invalidateAuthorization(input.userId, tx, false);
      return updated;
    }

    const member = await tx.storeMember.create({
      data: {
        storeId: input.storeId,
        userId: input.userId,
        roleId: role.id,
        status: input.status ?? StoreMemberStatus.PENDING,
        invitedByUserId: input.invitedByUserId,
        joinedAt: input.joinedAt
      }
    });
    await this.invalidateAuthorization(input.userId, tx, false);
    return member;
  }

  async invalidateAuthorization(
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
    revokeSessions: boolean
  ) {
    const activeSessions = await tx.session.findMany({
      where: {
        userId,
        revoked: false,
        expiresAt: { gt: new Date() }
      },
      select: { id: true }
    });
    const updated = await tx.user.update({
      where: { id: userId },
      data: { authzVersion: { increment: 1 } },
      select: { authzVersion: true }
    });
    if (revokeSessions) {
      await tx.session.updateMany({
        where: { userId, revoked: false },
        data: {
          revoked: true,
          revokedAt: new Date(),
          revokedReason: SessionRevokedReason.ROLE_CHANGED
        }
      });
    }
    void this.authStateInvalidator.invalidateUserVersions(userId, [
      updated.authzVersion - 1,
      updated.authzVersion
    ]);
    void this.authStateInvalidator.invalidateSessions(activeSessions.map((session) => session.id));
  }
}
