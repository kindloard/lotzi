const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const orderId = 'a19d44d0-0285-43da-9574-7b2b3b5c75a2';
  const o = await prisma.order.findUnique({ where: { id: orderId } });
  
  const ii = await prisma.inventoryItem.findMany({
    where: { storeId: o.storeId }
  });
  console.dir({ orderStoreId: o.storeId, inventoryItems: ii }, { depth: null });

  const il = await prisma.inventoryLocation.findMany({
    where: { storeId: o.storeId }
  });
  console.dir({ locations: il }, { depth: null });
}
main();
