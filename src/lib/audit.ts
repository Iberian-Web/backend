import { AuditAction } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Registra una operación irreversible (cancelar/eliminar un pedido, cerrar
 * una mesa, eliminar una mesa del mapa) para poder reconstruir después qué
 * pasó, quién lo hizo y cuándo. Nunca lanza: un fallo al auditar no debe
 * tumbar la operación real que se está auditando, así que cualquier error
 * solo se registra en consola.
 */
export async function logAudit(entry: {
  instanceId: number;
  action: AuditAction;
  actorName: string;
  tableNumber?: number | null;
  summary?: string;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        instanceId: entry.instanceId,
        action: entry.action,
        actorName: entry.actorName || "Desconocido",
        tableNumber: entry.tableNumber ?? null,
        summary: entry.summary ?? "",
      },
    });
  } catch (err) {
    console.error("No se pudo registrar la entrada de auditoría:", err);
  }
}
