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

/**
 * Igual que `ensureInstanceAccess`, pero además comprueba que el servicio
 * (o al menos uno de varios, si se pasa una lista) esté realmente activo
 * para el contrato — y, si quien llama es una credencial concreta (p. ej.
 * un camarero, no el login genérico del cliente), que ese servicio no le
 * haya sido desactivado (ver `CredentialService`).
 *
 * Esto es la comprobación real de permisos en el backend: ocultar el
 * enlace en el sidebar del portal es solo una ayuda de UI, nunca la única
 * barrera — sin esto, una credencial sin "Mapa" asignado podría seguir
 * llamando a la API de mesas directamente.
 */
export async function ensureServiceAccess(
  instanceId: number,
  serviceName: string | string[],
  req: { userId?: string; credentialId?: string },
) {
  const instance = await ensureInstanceAccess(instanceId, req.userId);
  const serviceNames = Array.isArray(serviceName) ? serviceName : [serviceName];

  const instanceServices = await prisma.instanceService.findMany({
    where: {
      instanceId,
      active: true,
      service: { name: { in: serviceNames } },
    },
    select: { serviceId: true },
  });
  if (instanceServices.length === 0) {
    throw new ApiError(
      403,
      `Este contrato no tiene activo el servicio "${serviceNames.join(" / ")}".`,
    );
  }

  // Sesión de credencial concreta: basta con que UNO de los servicios
  // solicitados no le esté desactivado explícitamente (opt-out, ver schema).
  if (req.credentialId) {
    const serviceIds = instanceServices.map((s) => s.serviceId);
    const overrides = await prisma.credentialService.findMany({
      where: { credentialId: req.credentialId, serviceId: { in: serviceIds } },
      select: { serviceId: true, enabled: true },
    });
    const disabled = new Set(
      overrides.filter((o) => !o.enabled).map((o) => o.serviceId),
    );
    const hasAccess = serviceIds.some((id) => !disabled.has(id));
    if (!hasAccess) {
      throw new ApiError(
        403,
        `No tienes acceso al servicio "${serviceNames.join(" / ")}".`,
      );
    }
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
