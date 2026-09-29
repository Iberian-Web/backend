import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Por defecto el pool solo abre ~10 conexiones a la vez: con tráfico alto,
// las peticiones se quedan haciendo cola esperando una libre aunque el
// servidor tenga CPU de sobra. DB_POOL_SIZE permite subirlo por entorno sin
// tocar código (y cuidado si además se corre en varios núcleos/procesos:
// cada uno abre su propio pool, así que el total es DB_POOL_SIZE × réplicas,
// no puede superar max_connections de Postgres).
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
  max: Number(process.env.DB_POOL_SIZE) || 20,
});

export const prisma = new PrismaClient({ adapter });

/** `include` de instancia reutilizado en customers, instances y payment. */
export const instanceWithDetails = {
  application: { include: { services: true } },
  instanceServices: { include: { service: true } },
} as const;
