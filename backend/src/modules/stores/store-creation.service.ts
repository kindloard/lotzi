import { Injectable } from "@nestjs/common";
import { Prisma, StoreMemberStatus } from "@prisma/client";
import { ROLE_CODES } from "../rbac/permissions";
import { RoleAssignmentService } from "../rbac/role-assignment.service";
import { StoreRepository } from "./repositories/store.repository";

@Injectable()
export class StoreCreationService {
  constructor(
    private readonly stores: StoreRepository,
    private readonly roles: RoleAssignmentService
  ) {}

  async ensurePendingStoreForMerchant(
    input: {
      ownerUserId: string;
      storeName: string;
      email?: string | null;
      phone?: string | null;
    },
    tx: Prisma.TransactionClient
  ) {
    const name = this.sanitizeStoreName(input.storeName);
    const existing = await this.stores.findPendingByCreatorAndName(input.ownerUserId, name, tx);
    const store =
      existing ??
      (await this.stores.createPending(
        {
          createdByUserId: input.ownerUserId,
          name,
          slug: await this.uniqueSlug(name, tx),
          email: input.email,
          phone: input.phone
        },
        tx
      ));

    const member = await this.roles.ensureStoreRole(
      {
        storeId: store.id,
        userId: input.ownerUserId,
        roleCode: ROLE_CODES.MERCHANT_OWNER,
        status: StoreMemberStatus.ACTIVE,
        joinedAt: new Date()
      },
      tx
    );

    return { store, member };
  }

  private async uniqueSlug(name: string, tx: Prisma.TransactionClient): Promise<string> {
    const base = this.slugify(name);
    for (let suffix = 0; suffix < 50; suffix += 1) {
      const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
      const existing = await this.stores.findBySlug(candidate, tx);
      if (!existing) {
        return candidate;
      }
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  private sanitizeStoreName(value: string): string {
    return value.trim().replace(/\s+/g, " ").slice(0, 160);
  }

  private slugify(value: string): string {
    const slug = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return slug || `store-${Date.now().toString(36)}`;
  }
}
