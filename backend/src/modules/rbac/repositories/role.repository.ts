import { Injectable } from "@nestjs/common";
import { Prisma, RoleScope, StoreMemberStatus } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";

@Injectable()
export class RoleRepository {
  constructor(readonly prisma: PrismaService) {}

  findRoleByCode(code: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.role.findUnique({ where: { code } });
  }

  findPlatformRolesForUser(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.userRoleAssignment.findMany({
      where: {
        userId,
        revokedAt: null
      },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true }
            }
          }
        }
      }
    });
  }

  findPlatformAuthorizationRows(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.$queryRaw<Array<{ role_code: string; permission_code: string | null }>>`
      WITH assigned_roles AS (
        SELECT ur.role_id
        FROM user_roles ur
        WHERE ur.user_id = ${userId}::uuid
          AND ur.revoked_at IS NULL

        UNION

        SELECT sm.role_id
        FROM store_members sm
        JOIN stores s ON s.id = sm.store_id
        WHERE sm.user_id = ${userId}::uuid
          AND sm.status = 'ACTIVE'
          AND s.deleted_at IS NULL
      )
      SELECT
        r.code AS role_code,
        p.code AS permission_code
      FROM assigned_roles ar
      JOIN roles r ON r.id = ar.role_id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
    `;
  }

  findActiveStoreMember(
    userId: string,
    storeId: string,
    tx: Prisma.TransactionClient = this.prisma
  ) {
    return tx.storeMember.findFirst({
      where: {
        userId,
        storeId,
        status: StoreMemberStatus.ACTIVE
      },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true }
            }
          }
        }
      }
    });
  }

  findStoreAuthorizationRows(
    userId: string,
    storeId: string,
    tx: Prisma.TransactionClient = this.prisma
  ) {
    return tx.$queryRaw<Array<{
      store_id: string;
      store_status: string;
      store_deleted_at: Date | null;
      member_id: string | null;
      role_code: string | null;
      permission_code: string | null;
    }>>`
      SELECT
        s.id AS store_id,
        s.status::text AS store_status,
        s.deleted_at AS store_deleted_at,
        sm.id AS member_id,
        r.code AS role_code,
        p.code AS permission_code
      FROM stores s
      LEFT JOIN store_members sm
        ON sm.store_id = s.id
       AND sm.user_id = ${userId}::uuid
       AND sm.status = 'ACTIVE'
      LEFT JOIN roles r ON r.id = sm.role_id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE s.id = ${storeId}::uuid
      ORDER BY r.code, p.code
    `;
  }

  listPermissions(scope?: RoleScope, tx: Prisma.TransactionClient = this.prisma) {
    return tx.permission.findMany({
      where: scope ? { scope } : undefined,
      select: { code: true }
    });
  }
}
