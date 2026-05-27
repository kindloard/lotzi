import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { MerchantProfileRepository } from "../repositories/merchant-profile.repository";

@Injectable()
export class MerchantCreationService {
  constructor(private readonly profiles: MerchantProfileRepository) {}

  ensureMerchantProfile(
    input: { userId: string; businessName: string; legalName?: string | null },
    tx?: Prisma.TransactionClient
  ) {
    return this.profiles.ensure(input, tx);
  }
}
