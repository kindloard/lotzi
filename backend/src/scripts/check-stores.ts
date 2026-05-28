import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const stores = await prisma.store.findMany({
    include: {
      businessProfile: true,
      branding: true,
      products: {
        include: {
          category: true,
        }
      }
    }
  });

  console.log("=== STORES IN DATABASE ===");
  console.log(JSON.stringify(stores, null, 2));

  const categories = await prisma.category.findMany();
  console.log("=== CATEGORIES IN DATABASE ===");
  console.log(JSON.stringify(categories, null, 2));
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
