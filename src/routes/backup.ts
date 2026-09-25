import { Router } from "express";
import { prisma } from "../lib/prisma";
import { ApiError } from "../lib/errors";
import { ADMIN_COOKIE_NAME } from "../lib/cookies";
import { requireSession } from "../middleware/session";

export const backupRouter = Router();
backupRouter.use(requireSession(ADMIN_COOKIE_NAME, { customer: false }));

/**
 * Versión del formato de backup. Si cambia la serialización, se sube este
 * número y se rechazan backups de versiones que ya no se sepan importar.
 */
const BACKUP_VERSION = 3;

/**
 * Tablas con id autonumérico cuya secuencia de PostgreSQL hay que
 * resincronizar tras restaurar un backup con ids explícitos, o el próximo
 * INSERT puede chocar con uno ya restaurado.
 */
const AUTOINCREMENT_TABLES: { schema: string; table: string }[] = [
  { schema: "public", table: "applications" },
  { schema: "public", table: "services" },
  { schema: "public", table: "instances" },
  { schema: "public", table: "documents" },
  { schema: "public", table: "instance_services" },
  { schema: "public", table: "credential_services" },
  { schema: "public", table: "payments" },
  { schema: "restaurant", table: "menus" },
  { schema: "restaurant", table: "menu_sections" },
  { schema: "restaurant", table: "dishes" },
  { schema: "restaurant", table: "reservations" },
  { schema: "restaurant", table: "table_sessions" },
  { schema: "restaurant", table: "orders" },
  { schema: "restaurant", table: "order_items" },
  { schema: "restaurant", table: "restaurant_tables" },
];

type Row = Record<string, unknown>;

/** Convierte a `Date` los campos indicados de cada fila (llegan como string ISO desde el JSON). */
function reviveDates(rows: Row[], fields: string[]): Row[] {
  if (fields.length === 0) return rows;
  return rows.map((row) => {
    const copy: Row = { ...row };
    for (const field of fields) {
      if (copy[field] !== undefined && copy[field] !== null) {
        copy[field] = new Date(copy[field] as string);
      }
    }
    return copy;
  });
}

/** El PDF (`Bytes`) no cabe tal cual en JSON: se guarda/lee como base64. */
function encodeDocument(doc: Row): Row {
  return {
    ...doc,
    data: Buffer.from(doc.data as Uint8Array).toString("base64"),
  };
}
function decodeDocument(doc: Row): Row {
  return { ...doc, data: Buffer.from(String(doc.data), "base64") };
}

// ── Exportar toda la base de datos ─────────────────────────────────────────
// Se excluye deliberadamente la tabla de sesiones: son tokens de acceso
// temporales (no datos del negocio) y restaurarlas no tendría sentido ni
// sería seguro.
backupRouter.get("/backup/export", async (_req, res) => {
  const [
    applications,
    services,
    users,
    instances,
    credentials,
    documents,
    instanceServices,
    credentialServices,
    payments,
    menus,
    menuSections,
    dishes,
    reservations,
    tableSessions,
    orders,
    orderItems,
    restaurantTables,
  ] = await Promise.all([
    prisma.application.findMany(),
    prisma.service.findMany(),
    prisma.user.findMany(),
    prisma.instance.findMany(),
    prisma.credential.findMany(),
    prisma.document.findMany(),
    prisma.instanceService.findMany(),
    prisma.credentialService.findMany(),
    prisma.payment.findMany(),
    prisma.menu.findMany(),
    prisma.menuSection.findMany(),
    prisma.dish.findMany(),
    prisma.reservation.findMany(),
    prisma.tableSession.findMany(),
    prisma.order.findMany(),
    prisma.orderItem.findMany(),
    prisma.restaurantTable.findMany(),
  ]);

  const backup = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      applications,
      services,
      users,
      instances,
      credentials,
      documents: documents.map(encodeDocument),
      instanceServices,
      credentialServices,
      payments,
      menus,
      menuSections,
      dishes,
      reservations,
      tableSessions,
      orders,
      orderItems,
      restaurantTables,
    },
  };

  const fileName = `iberian-web-backup-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.send(JSON.stringify(backup));
});

// ── Importar toda la base de datos ──────────────────────────────────────────
// SUSTITUYE POR COMPLETO todo lo anterior: vacía las tablas del negocio y
// reinserta los datos del backup manteniendo los mismos ids (las relaciones
// internas del backup también van por id).
backupRouter.post("/backup/import", async (req, res) => {
  const body = req.body as {
    version?: number;
    data?: Record<string, unknown>;
  };

  if (!body || typeof body !== "object" || !body.data) {
    throw new ApiError(
      400,
      "El archivo no tiene el formato de backup esperado.",
    );
  }
  if (body.version !== BACKUP_VERSION) {
    throw new ApiError(
      400,
      `Versión de backup no soportada (${body.version ?? "desconocida"}). Se esperaba la versión ${BACKUP_VERSION}.`,
    );
  }

  const d = body.data;
  const arr = (key: string): Row[] =>
    Array.isArray(d[key]) ? (d[key] as Row[]) : [];

  const applications = arr("applications");
  const services = arr("services");
  const users = reviveDates(arr("users"), ["createdAt", "updatedAt"]);
  const instances = reviveDates(arr("instances"), [
    "contractDate",
    "lastPaymentDate",
    "billingStartDate",
    "createdAt",
  ]);
  const credentials = reviveDates(arr("credentials"), [
    "createdAt",
    "updatedAt",
  ]);
  const documents = reviveDates(arr("documents"), ["createdAt"]).map(
    decodeDocument,
  );
  const instanceServices = arr("instanceServices");
  const credentialServices = arr("credentialServices");
  const payments = reviveDates(arr("payments"), ["paidAt"]);
  const menus = reviveDates(arr("menus"), ["createdAt"]);
  const menuSections = reviveDates(arr("menuSections"), ["createdAt"]);
  const dishes = arr("dishes");
  const reservations = reviveDates(arr("reservations"), [
    "reservationDate",
    "createdAt",
    "updatedAt",
  ]);
  // Las sesiones de mesa deben restaurarse ANTES que los pedidos: cada
  // pedido tiene una FK obligatoria a su sesión (tableSessionId), así que
  // si se insertasen en el orden contrario la restauración fallaría.
  const tableSessions = reviveDates(arr("tableSessions"), [
    "openedAt",
    "closedAt",
  ]);
  const orders = reviveDates(arr("orders"), ["createdAt", "updatedAt"]);
  const orderItems = arr("orderItems");
  const restaurantTables = reviveDates(arr("restaurantTables"), [
    "createdAt",
    "updatedAt",
  ]);

  const counts = {
    applications: applications.length,
    services: services.length,
    users: users.length,
    instances: instances.length,
    credentials: credentials.length,
    documents: documents.length,
    instanceServices: instanceServices.length,
    credentialServices: credentialServices.length,
    payments: payments.length,
    menus: menus.length,
    menuSections: menuSections.length,
    dishes: dishes.length,
    reservations: reservations.length,
    tableSessions: tableSessions.length,
    orders: orders.length,
    orderItems: orderItems.length,
    restaurantTables: restaurantTables.length,
  };

  await prisma.$transaction(
    async (tx) => {
      // 1. Vaciar todo. El resto de tablas del negocio cuelga en cascada de
      //    User o de Application, así que borrando estas dos (y las
      //    sesiones, que no dependen de ninguna) se vacía todo lo demás.
      await tx.session.deleteMany();
      await tx.user.deleteMany();
      await tx.application.deleteMany();

      // 2. Reinsertar en orden de dependencias (padres antes que hijos).
      if (applications.length)
        await tx.application.createMany({ data: applications as never });
      if (services.length)
        await tx.service.createMany({ data: services as never });
      if (users.length) await tx.user.createMany({ data: users as never });
      if (instances.length)
        await tx.instance.createMany({ data: instances as never });
      if (credentials.length)
        await tx.credential.createMany({ data: credentials as never });
      if (documents.length)
        await tx.document.createMany({ data: documents as never });
      if (instanceServices.length)
        await tx.instanceService.createMany({
          data: instanceServices as never,
        });
      if (credentialServices.length)
        await tx.credentialService.createMany({
          data: credentialServices as never,
        });
      if (payments.length)
        await tx.payment.createMany({ data: payments as never });
      if (menus.length) await tx.menu.createMany({ data: menus as never });
      if (menuSections.length)
        await tx.menuSection.createMany({ data: menuSections as never });
      if (dishes.length) await tx.dish.createMany({ data: dishes as never });
      if (reservations.length)
        await tx.reservation.createMany({ data: reservations as never });
      if (tableSessions.length)
        await tx.tableSession.createMany({ data: tableSessions as never });
      if (orders.length) await tx.order.createMany({ data: orders as never });
      if (orderItems.length)
        await tx.orderItem.createMany({ data: orderItems as never });
      if (restaurantTables.length)
        await tx.restaurantTable.createMany({
          data: restaurantTables as never,
        });

      // 3. Resincronizar las secuencias de autoincremento: si no, el
      //    próximo INSERT nuevo podría intentar reutilizar un id que el
      //    backup acaba de restaurar y fallar por clave duplicada.
      for (const { schema, table } of AUTOINCREMENT_TABLES) {
        await tx.$executeRawUnsafe(
          `SELECT setval(pg_get_serial_sequence('"${schema}"."${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${schema}"."${table}"), 1), true)`,
        );
      }
    },
    { timeout: 120_000, maxWait: 30_000 },
  );

  // Se han borrado todas las sesiones (incluida la de quien acaba de
  // importar): todo el mundo, admin incluido, tendrá que volver a iniciar
  // sesión. Es lo correcto tras sustituir la base de datos entera.
  res.status(200).json({ imported: counts });
});
