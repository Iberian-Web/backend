import { AuditAction } from "@prisma/client";
import { prisma } from "./prisma";

/** Registra una operación irreversible (cancelar/eliminar pedido, cerrar
 *  mesa...). Nunca lanza: un fallo al auditar no debe tumbar la operación real. */
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
