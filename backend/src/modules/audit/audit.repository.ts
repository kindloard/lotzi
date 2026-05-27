import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  createLog(args: Prisma.AuditLogCreateArgs) {
    return this.prisma.auditLog.create(args);
  }

  createOutbox(args: Prisma.AuditOutboxCreateArgs) {
    return this.prisma.auditOutbox.create(args);
  }
}
