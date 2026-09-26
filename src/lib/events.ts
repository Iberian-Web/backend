import type { Response } from "express";

/**
 * Notificación en tiempo real muy simple basada en Server-Sent Events:
 * cada conexión abierta (`GET /instances/:id/events`) se guarda aquí, y
 * `publish()` la usa para avisar a todos los clientes conectados a esa
 * instancia de que algo cambió (pedido nuevo, estado cambiado, mesa
 * cerrada...), sin que tengan que hacer polling cada pocos segundos para
 * enterarse. Vive en memoria del proceso: para un despliegue con más de
 * una réplica del backend habría que sustituirlo por un pub/sub real
 * (Redis, etc.) — aquí basta porque el docker-compose despliega una sola.
 */

type RealtimeEvent = Record<string, unknown>;

const subscribersByInstance = new Map<number, Set<Response>>();

export function subscribe(instanceId: number, res: Response) {
  if (!subscribersByInstance.has(instanceId)) {
    subscribersByInstance.set(instanceId, new Set());
  }
  subscribersByInstance.get(instanceId)!.add(res);
}

export function unsubscribe(instanceId: number, res: Response) {
  const conns = subscribersByInstance.get(instanceId);
  if (!conns) return;
  conns.delete(res);
  if (conns.size === 0) subscribersByInstance.delete(instanceId);
}

/** Notifica a todos los clientes conectados a esta instancia (no hace nada si no hay ninguno). */
export function publish(instanceId: number, event: RealtimeEvent) {
  const conns = subscribersByInstance.get(instanceId);
  if (!conns || conns.size === 0) return;
  const payload = `data: ${JSON.stringify({ ...event, at: new Date().toISOString() })}\n\n`;
  for (const res of conns) {
    try {
      res.write(payload);
    } catch {
      // Conexión ya cerrada por el otro lado: se limpiará en el "close" del
      // handler de la ruta, no hace falta hacer nada aquí.
    }
  }
}
