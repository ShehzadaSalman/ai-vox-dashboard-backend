import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const plans = [
    {
      code: "TRIAL",
      name: "Free Trial",
      monthly_minutes_limit: 20,
      price_cents: 0
    },
    {
      code: "SILVER",
      name: "Silver",
      monthly_minutes_limit: 300,
      price_cents: 12900
    },
    {
      code: "GOLD",
      name: "Gold",
      monthly_minutes_limit: 900,
      price_cents: 24900
    }
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        monthly_minutes_limit: plan.monthly_minutes_limit,
        price_cents: plan.price_cents,
        is_active: true
      },
      create: {
        ...plan,
        is_active: true
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("Seed failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
