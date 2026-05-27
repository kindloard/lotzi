import { PrismaClient } from "@prisma/client";
import { repairProductCatalogSchema, verifyProductCatalogSchema } from "./product-catalog-schema";

const prisma = new PrismaClient();

async function main() {
  const before = await verifyProductCatalogSchema(prisma);
  console.log(JSON.stringify({ phase: "before", ...before }, null, 2));

  await repairProductCatalogSchema(prisma);

  const after = await verifyProductCatalogSchema(prisma);
  console.log(JSON.stringify({ phase: "after", ...after }, null, 2));

  if (!after.ok) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
