import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { RoleAssignmentService } from "../../rbac/role-assignment.service";
import { CustomerProfileRepository } from "../repositories/customer-profile.repository";

@Injectable()
export class CustomerCreationService {
  constructor(
    private readonly profiles: CustomerProfileRepository,
    private readonly roles: RoleAssignmentService
  ) {}

  async ensureCustomer(
    input: { userId: string; displayName?: string | null; phone?: string | null },
    tx?: Prisma.TransactionClient
  ) {
    await this.profiles.ensure(input, tx);
    await this.roles.ensureCustomerRole(input.userId, tx);
  }
}
