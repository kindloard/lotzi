import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';

interface CheckoutItem {
  productId: string;
  variantId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

interface PosCheckoutPayload {
  storeId: string;
  registerId: string;
  sessionId: string;
  items: CheckoutItem[];
  payments: {
    method: 'CASH' | 'CARD' | 'UPI';
    amount: number;
    tenderedAmount?: number;
    reference?: string;
  }[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
}

@Injectable()
export class PosCheckoutService {
  private readonly logger = new Logger(PosCheckoutService.name);

  constructor(private readonly prisma: PrismaService) {}

  async processCheckout(payload: PosCheckoutPayload) {
    this.logger.log(`Processing POS checkout for store ${payload.storeId}`);

    // Verify session is OPEN
    const session = await this.prisma.pOSSession.findUnique({
      where: { id: payload.sessionId },
    });

    if (!session || session.status !== 'OPEN') {
      throw new BadRequestException('Invalid or closed POS session');
    }

    // Generate receipt number (simple version, normally you'd use a sequence or shortid)
    const receiptNumber = `POS-${Date.now().toString().slice(-6)}`;

    // Use Prisma interactive transaction for atomic safety
    return this.prisma.$transaction(async (tx) => {
      // 1. Create the POS Sale
      const sale = await tx.pOSSale.create({
        data: {
          storeId: payload.storeId,
          registerId: payload.registerId,
          sessionId: payload.sessionId,
          receiptNumber,
          subtotal: payload.subtotal,
          taxTotal: payload.taxTotal,
          discountTotal: payload.discountTotal,
          grandTotal: payload.grandTotal,
          status: 'COMPLETED',
          items: {
            create: payload.items.map(item => ({
              productId: item.productId,
              variantId: item.variantId,
              name: item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              total: item.quantity * item.unitPrice,
            })),
          },
          payments: {
            create: payload.payments.map(payment => ({
              method: payment.method,
              amount: payment.amount,
              tenderedAmount: payment.tenderedAmount,
              changeAmount: payment.tenderedAmount ? payment.tenderedAmount - payment.amount : 0,
              reference: payment.reference,
            })),
          },
        },
        include: { items: true, payments: true },
      });

      // 2. Inventory Deduction
      for (const item of payload.items) {
        // Find the variant stock
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
        });

        if (!variant) throw new BadRequestException(`Variant ${item.variantId} not found`);

        // Update the variant stock (optimistic locking not strictly enforced here for speed, 
        // but normally we'd check stockVersion)
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: {
            stock: { decrement: item.quantity },
            stockOnHand: { decrement: item.quantity },
            stockVersion: { increment: 1 },
          },
        });

        // Normally we'd also write to InventoryLedger, but since it's a complex model requiring 
        // specific ledger structures in namastore, we simplify for this blueprint.
        // await tx.inventoryLedger.create(...)
      }

      this.logger.log(`Checkout ${receiptNumber} completed successfully`);
      return sale;
    }, {
      maxWait: 5000, // 5s max wait for transaction
      timeout: 10000, // 10s timeout
    });
  }
}
