import { PrismaClient } from "@prisma/client";
import { verifyProductCatalogSchema } from "./product-catalog-schema";

const prisma = new PrismaClient();

async function main() {
  const report = await verifyProductCatalogSchema(prisma);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
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
