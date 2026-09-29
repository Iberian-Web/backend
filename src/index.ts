import "dotenv/config";
import cluster from "node:cluster";
import os from "node:os";
import { syncApplications } from "./catalogue";
import { prisma } from "./lib/prisma";

const port = process.env.PORT || 3001;

// Node ejecuta JS en un solo hilo: un único proceso solo usa un núcleo por
// muy potente que sea el servidor. WEB_CONCURRENCY permite fijar el número
// de procesos trabajadores; por defecto, uno por núcleo disponible. Ponlo a
// 1 para volver al comportamiento de un solo proceso (p. ej. en local).
const numWorkers = Number(process.env.WEB_CONCURRENCY) || os.cpus().length;

if (cluster.isPrimary) {
  runPrimary();
} else {
  runWorker().catch((err) => {
    console.error("❌ Error al inicializar el worker:", err);
    process.exit(1);
  });
}

/** El primario no atiende peticiones: solo sincroniza el catálogo una vez
 *  (no tendría sentido repetirlo por cada trabajador) y reparte el trabajo
 *  entre `numWorkers` procesos, reponiendo el que se caiga. */
function runPrimary() {
  let shuttingDown = false;

  syncApplications()
    .then(() => prisma.$disconnect()) // el primario no vuelve a tocar la BD
    .then(() => {
      console.log(
        `[cluster] arrancando ${numWorkers} proceso(s) trabajador(es)`,
      );
      for (let i = 0; i < numWorkers; i++) cluster.fork();
    })
    .catch((err) => {
      console.error("❌ Error al inicializar:", err);
      process.exit(1);
    });

  cluster.on("exit", (worker, code, signal) => {
    if (shuttingDown) return;
    console.error(
      `[cluster] worker ${worker.process.pid} caído (código ${code}, señal ${signal}) — reiniciando`,
    );
    cluster.fork();
  });

  const shutdown = () => {
    shuttingDown = true;
    for (const worker of Object.values(cluster.workers ?? {})) {
      worker?.process.kill("SIGTERM");
    }
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

/** Cada worker es un proceso Node completo con su propia app Express y su
 *  propia conexión LISTEN (lib/events.ts) — por eso el cambio a LISTEN/NOTIFY
 *  hacía falta antes de esto: cada worker ya se comporta como una réplica
 *  más, avisándose entre sí vía Postgres en vez de por memoria compartida
 *  (que aquí no existe: son procesos separados). Node reparte las conexiones
 *  entrantes del puerto entre todos los workers automáticamente. */
async function runWorker() {
  // Import diferido: el primario nunca atiende peticiones, así que no
  // necesita cargar Express ni las rutas — solo lo hace cada worker.
  const { app } = await import("./app.js");
  const { startRealtimeListener, stopRealtimeListener } =
    await import("./lib/events.js");

  startRealtimeListener();
  const server = app.listen(port);

  const shutdown = () => {
    server.close();
    void stopRealtimeListener();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
