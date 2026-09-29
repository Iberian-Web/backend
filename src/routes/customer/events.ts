import { Router } from "express";
import { ensureServiceAccess } from "../../lib/access";
import { subscribe, unsubscribe } from "../../lib/events";

export const eventsRouter = Router();

const HEARTBEAT_MS = 25_000;

// Stream SSE de avisos de "algo cambió" (pedido, mesa…). Solo notifica;
// el cliente reacciona re-consultando su propia query.
eventsRouter.get("/instances/:instanceId/events", async (req, res) => {
  const instanceId = Number(req.params.instanceId);
  await ensureServiceAccess(instanceId, ["Pedidos", "Cocina", "Mapa"], req);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Evita que un proxy intermedio (nginx, etc.) almacene en buffer la
    // respuesta esperando a que "termine" — un stream SSE no termina.
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");

  subscribe(instanceId, res);

  const heartbeat = setInterval(() => {
    // Comentario SSE (ignorado por EventSource): mantiene viva la conexión
    // a través de proxies/balanceadores que cierran sockets inactivos.
    res.write(": ping\n\n");
  }, HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe(instanceId, res);
  });
});
