import { prisma } from "./prisma";
import { ApiError } from "./errors";

export async function ensureInstanceAccess(
  instanceId: number,
  userId?: string,
) {
  const instance = await prisma.instance.findFirst({
    where: { id: instanceId, ...(userId ? { userId } : {}) },
  });
  if (!instance) {
    throw new ApiError(
      userId ? 403 : 404,
      userId ? "Acceso denegado." : "Instancia no encontrada.",
    );
  }
  return instance;
}

export async function ensureCustomer(id: string) {
  const customer = await prisma.user.findFirst({
    where: { id },
    select: { id: true },
  });
  if (!customer) throw new ApiError(404, "Cliente no encontrado");
}
