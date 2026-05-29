import { Injectable, Logger } from "@nestjs/common";
import { PaymentStatus, ReconciliationStatus } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { PaymentsService } from "./payments.service";

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService
  ) {}

  async runDue(limit = 50) {
    const runs = await this.prisma.reconciliationRun.findMany({
      where: {
        status: { in: [ReconciliationStatus.PENDING, ReconciliationStatus.FAILED] },
        nextCheckAt: { lte: new Date() }
      },
      include: { payment: true },
      orderBy: { nextCheckAt: "asc" },
      take: limit
    });

    let resolved = 0;
    for (const run of runs) {
      await this.prisma.reconciliationRun.update({
        where: { id: run.id },
        data: { status: ReconciliationStatus.IN_PROGRESS, attempts: { increment: 1 } }
      });
      try {
        await this.payments.verifyPaymentWithGateway(run.payment.cashfreeOrderId, `reconciliation:${run.id}`);
        const payment = await this.prisma.payment.findUnique({ where: { id: run.paymentId } });
        const isSettled = payment?.status === PaymentStatus.PAID || payment?.status === PaymentStatus.FAILED || payment?.status === PaymentStatus.EXPIRED;
        await this.prisma.reconciliationRun.update({
          where: { id: run.id },
          data: {
            status: isSettled ? ReconciliationStatus.RESOLVED : ReconciliationStatus.PENDING,
            resolvedAt: isSettled ? new Date() : null,
            nextCheckAt: new Date(Date.now() + 5 * 60_000),
            lastError: null
          }
        });
        if (isSettled) {
          resolved += 1;
        }
      } catch (error) {
        const attempts = run.attempts + 1;
        await this.prisma.reconciliationRun.update({
          where: { id: run.id },
          data: {
            status: attempts >= 8 ? ReconciliationStatus.DLQ : ReconciliationStatus.FAILED,
            nextCheckAt: new Date(Date.now() + reconciliationBackoffMs(attempts)),
            lastError: error instanceof Error ? error.message : String(error)
          }
        });
        this.logger.warn(`Reconciliation ${run.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { apiVersion: "v1", scanned: runs.length, resolved };
  }
}

function reconciliationBackoffMs(attempts: number) {
  const schedule = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000, 6 * 60 * 60_000, 12 * 60 * 60_000, 24 * 60 * 60_000];
  return schedule[Math.min(attempts - 1, schedule.length - 1)]!;
}
