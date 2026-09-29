import type { Response } from "express";
import { Client } from "pg";
import { prisma } from "./prisma";

/**
 * Notificaciones en tiempo real vía SSE. Cada conexión abierta se guarda en
 * memoria de este proceso (`subscribersByInstance`), pero avisar de un
 * cambio ya no se limita a él: `publish()` manda un NOTIFY de Postgres y
 * cada réplica del backend —incluida la que publica— lo recibe por su
 * propia conexión de escucha y reenvía el evento a sus clientes locales.
 * Así el tiempo real sigue funcionando con varias réplicas detrás de un
 * balanceador, no solo con una.
 */

type RealtimeEvent = Record<string, unknown>;

const CHANNEL = "restaurant_events";

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

/** Reenvía el evento a los clientes SSE conectados a este mismo proceso
 *  (no hace nada si aquí no hay ninguno suscrito a esa instancia). */
function deliverLocally(instanceId: number, event: RealtimeEvent) {
  const conns = subscribersByInstance.get(instanceId);
  if (!conns || conns.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of conns) {
    try {
      res.write(payload);
    } catch {
      // Conexión ya cerrada por el otro lado: se limpiará en el "close" del
      // handler de la ruta, no hace falta hacer nada aquí.
    }
  }
}

/** Avisa a todos los clientes de una instancia, estén conectados a esta
 *  réplica del backend o a otra. Pasa siempre por Postgres (nunca entrega
 *  en local directamente) para no duplicar el aviso a quien esté conectado
 *  a este mismo proceso: también le llegará por su propio LISTEN.
 *  Nunca lanza: un fallo al notificar no debe tumbar la operación real
 *  (el cliente lo acabará viendo igualmente en el siguiente sondeo). */
export async function publish(instanceId: number, event: RealtimeEvent) {
  try {
    const payload = JSON.stringify({
      instanceId,
      event: { ...event, at: new Date().toISOString() },
    });
    await prisma.$executeRaw`SELECT pg_notify(${CHANNEL}, ${payload})`;
  } catch (err) {
    console.error("[realtime] no se pudo publicar el evento:", err);
  }
}

// ── Escucha compartida entre réplicas ───────────────────────────────────────
// LISTEN necesita mantenerse en una misma sesión de Postgres, algo que un
// pool de conexiones normal no garantiza — de ahí esta conexión dedicada,
// separada del pool que usa Prisma para el resto de queries.

let listenerClient: Client | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

async function connectListener() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  client.on("error", (err) => {
    console.error("[realtime] conexión LISTEN interrumpida:", err.message);
    scheduleReconnect();
  });
  client.on("end", () => scheduleReconnect());
  client.on("notification", (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    try {
      const { instanceId, event } = JSON.parse(msg.payload);
      deliverLocally(instanceId, event);
    } catch (err) {
      console.error("[realtime] payload de NOTIFY inválido:", err);
    }
  });

  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
  listenerClient = client;
  console.log("[realtime] escuchando notificaciones de Postgres");
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return;
  listenerClient = null;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectListener().catch((err) => {
      console.error("[realtime] fallo al reconectar, reintento en 5s:", err);
      scheduleReconnect();
    });
  }, 5000);
}

/** Arranca la escucha de eventos entre réplicas; se llama una vez al iniciar el servidor. */
export function startRealtimeListener() {
  connectListener().catch((err) => {
    console.error("[realtime] fallo al conectar, reintento en 5s:", err);
    scheduleReconnect();
  });
}

/** Cierra la conexión de escucha de forma ordenada (apagado del proceso). */
export async function stopRealtimeListener() {
  shuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  await listenerClient?.end().catch(() => {});
  listenerClient = null;
}
