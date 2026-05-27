import { Injectable } from "@nestjs/common";
import { Prisma, UserStatus } from "@prisma/client";
import { UserRepository } from "../repositories/user.repository";

@Injectable()
export class UserCreationService {
  constructor(private readonly users: UserRepository) {}

  async createOrUpdatePendingEmailUser(
    input: {
      id: string;
      email: string;
      fullName: string;
      passwordHash: string;
    },
    tx: Prisma.TransactionClient
  ) {
    const existing = await this.users.findByEmail(input.email, tx);
    if (existing && existing.status !== UserStatus.PENDING) {
      return { user: existing, created: false, blockedByExistingActiveUser: true };
    }

    if (existing) {
      const user = await this.users.updatePendingSignup(
        existing.id,
        {
          fullName: input.fullName,
          passwordHash: input.passwordHash
        },
        tx
      );
      return { user, created: false, blockedByExistingActiveUser: false };
    }

    const user = await this.users.createEmailUser(
      {
        id: input.id,
        email: input.email,
        fullName: input.fullName,
        passwordHash: input.passwordHash,
        status: UserStatus.PENDING
      },
      tx
    );
    return { user, created: true, blockedByExistingActiveUser: false };
  }
}
