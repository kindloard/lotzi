import { Injectable } from "@nestjs/common";
import { Prisma, UserProviderType, UserStatus } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";

@Injectable()
export class UserRepository {
  constructor(readonly prisma: PrismaService) {}

  findByEmail(email: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.user.findUnique({ where: { email } });
  }

  findById(id: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.user.findUnique({ where: { id } });
  }

  createEmailUser(
    input: {
      id?: string;
      email: string;
      fullName: string;
      passwordHash: string;
      status?: UserStatus;
    },
    tx: Prisma.TransactionClient = this.prisma
  ) {
    return tx.user.create({
      data: {
        id: input.id,
        email: input.email,
        fullName: input.fullName,
        passwordHash: input.passwordHash,
        providerType: UserProviderType.EMAIL,
        status: input.status ?? UserStatus.PENDING
      }
    });
  }

  createGoogleUser(
    input: {
      email: string;
      fullName: string | null;
      avatarUrl: string | null;
    },
    tx: Prisma.TransactionClient = this.prisma
  ) {
    return tx.user.create({
      data: {
        email: input.email,
        fullName: input.fullName,
        avatarUrl: input.avatarUrl,
        providerType: UserProviderType.GOOGLE,
        emailVerified: true,
        status: UserStatus.ACTIVE
      }
    });
  }

  updatePendingSignup(
    id: string,
    input: { fullName: string; passwordHash: string },
    tx: Prisma.TransactionClient = this.prisma
  ) {
    return tx.user.update({
      where: { id },
      data: {
        fullName: input.fullName,
        passwordHash: input.passwordHash
      }
    });
  }

  activateVerifiedEmail(id: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.user.update({
      where: { id },
      data: {
        status: UserStatus.ACTIVE,
        emailVerified: true
      }
    });
  }

  incrementAuthzVersion(
    id: string,
    tx: Prisma.TransactionClient = this.prisma
  ) {
    return tx.user.update({
      where: { id },
      data: { authzVersion: { increment: 1 } },
      select: { authzVersion: true }
    });
  }
}
