import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';

@Injectable()
export class PosSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async openSession(registerId: string, openingFloat: number) {
    // Check if register already has an open session
    const activeSession = await this.prisma.pOSSession.findFirst({
      where: { registerId, status: 'OPEN' },
    });

    if (activeSession) {
      throw new BadRequestException('Register already has an open session');
    }

    return this.prisma.pOSSession.create({
      data: {
        registerId,
        openingFloat,
        status: 'OPEN',
      },
    });
  }

  async closeSession(sessionId: string, actualCash: number) {
    const session = await this.prisma.pOSSession.findUnique({
      where: { id: sessionId },
      include: {
        sales: {
          include: { payments: true },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.status === 'CLOSED') {
      throw new BadRequestException('Session is already closed');
    }

    // Calculate expected cash
    // expected cash = opening float + total cash payments - total cash change
    let totalCashSales = 0;
    session.sales.forEach(sale => {
      sale.payments.forEach(payment => {
        if (payment.method === 'CASH') {
          totalCashSales += Number(payment.amount);
        }
      });
    });

    const expectedCash = Number(session.openingFloat) + totalCashSales;

    return this.prisma.pOSSession.update({
      where: { id: sessionId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        actualCash,
        expectedCash,
      },
    });
  }

  async getSessionStatus(sessionId: string) {
    const session = await this.prisma.pOSSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException('Session not found');
    }
    return session;
  }
}
