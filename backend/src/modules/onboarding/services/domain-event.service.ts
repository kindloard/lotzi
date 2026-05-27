import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";

@Injectable()
export class DomainEventService {
  constructor(private readonly prisma: PrismaService) {}

  enqueue(
    input: {
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      payload?: Prisma.InputJsonValue;
    },
    tx: Prisma.TransactionClient = this.prisma
  ) {
    return tx.domainEvent.create({
      data: {
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload ?? {}
      }
    });
  }
}
