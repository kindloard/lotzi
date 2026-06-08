import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';

@Injectable()
export class PosRegisterService {
  constructor(private readonly prisma: PrismaService) {}

  async createRegister(storeId: string, name: string) {
    return this.prisma.pOSRegister.create({
      data: {
        storeId,
        name,
      },
    });
  }

  async getRegisters(storeId: string) {
    return this.prisma.pOSRegister.findMany({
      where: { storeId },
      include: {
        sessions: {
          where: { status: 'OPEN' },
          take: 1,
        },
      },
    });
  }

  async getRegisterById(id: string, storeId: string) {
    const register = await this.prisma.pOSRegister.findFirst({
      where: { id, storeId },
    });
    if (!register) {
      throw new NotFoundException('Register not found');
    }
    return register;
  }
}
