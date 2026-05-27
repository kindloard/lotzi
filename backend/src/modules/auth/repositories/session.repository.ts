import { Injectable } from "@nestjs/common";
import { Prisma, SessionRevokedReason } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";

export interface CreateSessionInput {
  userId: string;
  tokenFamilyId: string;
  refreshTokenHash: string;
  refreshTokenJti?: string;
  refreshTokenParentJti?: string;
  refreshTokenIssuedAt?: Date;
  clientSecretHash?: string;
  deviceFingerprint: string;
  deviceMetadata: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
  expiresAt: Date;
  persistent?: boolean;
}

@Injectable()
export class SessionRepository {
  constructor(readonly prisma: PrismaService) {}

  create(input: CreateSessionInput, tx: Prisma.TransactionClient = this.prisma) {
    return tx.session.create({
      data: {
        userId: input.userId,
        tokenFamilyId: input.tokenFamilyId,
        refreshTokenHash: input.refreshTokenHash,
        refreshTokenJti: input.refreshTokenJti,
        refreshTokenParentJti: input.refreshTokenParentJti,
        refreshTokenIssuedAt: input.refreshTokenIssuedAt,
        clientSecretHash: input.clientSecretHash,
        deviceFingerprint: input.deviceFingerprint,
        deviceMetadata: input.deviceMetadata,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        expiresAt: input.expiresAt,
        persistent: input.persistent ?? true
      }
    });
  }

  findByRefreshHash(refreshTokenHash: string) {
    return this.prisma.session.findUnique({
      where: { refreshTokenHash },
      include: { user: true }
    });
  }

  findConsumedRefresh(refreshTokenHash: string) {
    return this.prisma.refreshTokenHistory.findUnique({
      where: { refreshTokenHash }
    });
  }

  findActiveById(sessionId: string) {
    return this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: true }
    });
  }

  async rotateRefreshToken(input: {
    sessionId: string;
    oldHash: string;
    newHash: string;
    expiresAt: Date;
    refreshTokenJti: string;
    refreshTokenParentJti: string;
    refreshTokenIssuedAt: Date;
    clientSecretHash: string;
    consumedRefreshTokenJti?: string;
    replacementRefreshTokenJti: string;
    deviceFingerprint: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.session.findUniqueOrThrow({
        where: { id: input.sessionId },
        include: { user: true }
      });

      if (session.refreshTokenHash !== input.oldHash || session.revoked || session.expiresAt <= new Date()) {
        throw new Error("Session is no longer refreshable.");
      }

      await tx.refreshTokenHistory.create({
        data: {
          sessionId: session.id,
          userId: session.userId,
          tokenFamilyId: session.tokenFamilyId,
          refreshTokenHash: input.oldHash,
          refreshTokenJti: input.consumedRefreshTokenJti,
          replacementRefreshTokenJti: input.replacementRefreshTokenJti,
          deviceFingerprint: input.deviceFingerprint,
          expiresAt: session.expiresAt
        }
      });

      return tx.session.update({
        where: { id: session.id },
        data: {
          refreshTokenHash: input.newHash,
          refreshTokenJti: input.refreshTokenJti,
          refreshTokenParentJti: input.refreshTokenParentJti,
          refreshTokenIssuedAt: input.refreshTokenIssuedAt,
          clientSecretHash: input.clientSecretHash,
          expiresAt: input.expiresAt,
          lastSeenAt: new Date()
        },
        include: { user: true }
      });
    });
  }

  markConsumedRefreshReuse(historyId: string) {
    return this.prisma.refreshTokenHistory.update({
      where: { id: historyId },
      data: { reuseDetectedAt: new Date() }
    });
  }

  revokeTokenFamily(tokenFamilyId: string, reason: SessionRevokedReason) {
    return this.prisma.session.updateMany({
      where: { tokenFamilyId, revoked: false },
      data: {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: reason
      }
    });
  }

  listActiveIdsForTokenFamily(tokenFamilyId: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.session.findMany({
      where: {
        tokenFamilyId,
        revoked: false,
        expiresAt: { gt: new Date() }
      },
      select: { id: true }
    });
  }

  listActiveIdsForUser(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.session.findMany({
      where: {
        userId,
        revoked: false,
        expiresAt: { gt: new Date() }
      },
      select: { id: true }
    });
  }

  revokeSession(sessionId: string, reason: SessionRevokedReason) {
    return this.prisma.session.updateMany({
      where: { id: sessionId, revoked: false },
      data: {
        revoked: true,
        revokedAt: new Date(),
        revokedReason: reason
      }
    });
  }

  listActiveForUser(userId: string) {
    return this.prisma.session.findMany({
      where: {
        userId,
        revoked: false,
        expiresAt: { gt: new Date() }
      },
      orderBy: { lastSeenAt: "desc" },
      select: {
        id: true,
        deviceMetadata: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true
      }
    });
  }
}
