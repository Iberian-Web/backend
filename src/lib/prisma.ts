import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });

export const prisma = new PrismaClient({ adapter });

/** `include` de instancia reutilizado en customers, instances y payment. */
export const instanceWithDetails = {
  application: { include: { services: true } },
  instanceServices: { include: { service: true } },
} as const;
