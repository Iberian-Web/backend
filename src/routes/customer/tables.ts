import { Router } from "express";
import { Prisma, TableShape } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { ensureServiceAccess } from "../../lib/access";
import { resolveWaiterName } from "../../middleware/session";
import { logAudit } from "../../lib/audit";
import { publish } from "../../lib/events";
import { checkNotStale, checkNotStaleInTx } from "../../lib/concurrency";

export const tablesRouter = Router();

const VALID_SHAPES: TableShape[] = ["RECTANGLE", "ROUND"];

// Límites de sentido común: sin ellos, una llamada directa a la API
// (saltándose el `max` del formulario) podría crear una mesa gigante.
const MAX_TABLE_DIMENSION = 6;
const MAX_TABLE_POSITION = 200;

/** Estado de ocupación calculado para una mesa del mapa. */
type TableMapStatus = "LIBRE" | "EN_COCINA" | "LISTO" | "PARA_COBRAR";

type TableInput = {
  number?: number;
  name?: string;
  seats?: number;
  shape?: TableShape;
  posRow?: number;
  posCol?: number;
  width?: number;
  height?: number;
};

/** Valida y normaliza los campos de mesa recibidos en el body. `partial`
 * permite que falten campos (PUT parcial); en la creación (POST) los
 * campos obligatorios se exigen antes de llamar a esta función. */
function parseTableInput(
  body: Record<string, unknown>,
  { partial }: { partial: boolean },
): TableInput {
  const result: TableInput = {};

  if (body.number !== undefined) {
    const number = Number(body.number);
    if (!Number.isInteger(number) || number <= 0) {
      throw new ApiError(400, "El número de mesa debe ser un entero positivo");
    }
    result.number = number;
  } else if (!partial) {
    throw new ApiError(400, "El número de mesa es requerido");
  }

  if (body.name !== undefined) {
    result.name = String(body.name).trim();
  }

  if (body.seats !== undefined) {
    const seats = Number(body.seats);
    if (!Number.isInteger(seats) || seats <= 0) {
      throw new ApiError(
        400,
        "El número de comensales debe ser un entero positivo",
      );
    }
    result.seats = seats;
  } else if (!partial) {
    result.seats = 2;
  }

  if (body.shape !== undefined) {
    if (!VALID_SHAPES.includes(body.shape as TableShape)) {
      throw new ApiError(
        400,
        `Forma inválida. Debe ser una de: ${VALID_SHAPES.join(", ")}`,
      );
    }
    result.shape = body.shape as TableShape;
  }

  for (const field of ["posRow", "posCol"] as const) {
    if (body[field] !== undefined) {
      const value = Number(body[field]);
      if (!Number.isInteger(value) || value < 0) {
        throw new ApiError(
          400,
          `${field} debe ser un entero mayor o igual que 0`,
        );
      }
      if (value > MAX_TABLE_POSITION) {
        throw new ApiError(
          400,
          `${field} no puede ser mayor que ${MAX_TABLE_POSITION}`,
        );
      }
      result[field] = value;
    } else if (!partial) {
      result[field] = 0;
    }
  }

  for (const field of ["width", "height"] as const) {
    if (body[field] !== undefined) {
      const value = Number(body[field]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new ApiError(400, `${field} debe ser un entero positivo`);
      }
      if (value > MAX_TABLE_DIMENSION) {
        throw new ApiError(
          400,
          `${field} no puede ser mayor que ${MAX_TABLE_DIMENSION} celdas`,
        );
      }
      result[field] = value;
    } else if (!partial) {
      result[field] = 1;
    }
  }

  return result;
}

/** Deriva el estado de ocupación de una mesa a partir de los pedidos
 * (no cancelados) de su sesión abierta, reutilizando la misma lógica de
 * "sigue activa" que el cierre de mesa en orders.ts. */
function deriveStatus(billableOrders: { status: string }[]): TableMapStatus {
  const active = billableOrders.filter((o) =>
    ["PENDING", "IN_PROGRESS", "READY"].includes(o.status),
  );
  if (
    active.some((o) => o.status === "PENDING" || o.status === "IN_PROGRESS")
  ) {
    return "EN_COCINA";
  }
  if (active.some((o) => o.status === "READY")) return "LISTO";
  // Ya no queda ningún pedido activo: o la mesa no tiene pedidos
  // facturables (no debería llegar aquí, ver caller) o todos están
  // entregados y falta cobrar.
  return "PARA_COBRAR";
}

// GET /api/instances/:instanceId/tables — mapa de mesas con su estado actual
tablesRouter.get("/instances/:instanceId/tables", async (req, res) => {
  const instanceId = Number(req.params.instanceId);
  await ensureServiceAccess(instanceId, "Mapa", req);

  const [tables, openSessions] = await Promise.all([
    prisma.restaurantTable.findMany({
      where: { instanceId },
      orderBy: { number: "asc" },
    }),
    prisma.tableSession.findMany({
      where: { instanceId, closedAt: null },
      include: { orders: { include: { items: true } } },
      orderBy: { openedAt: "desc" },
    }),
  ]);

  // Puede haber más de una sesión abierta histórica por número de mesa en
  // teoría no debería, pero por robustez nos quedamos con la más reciente.
  const sessionByTableNumber = new Map<number, (typeof openSessions)[number]>();
  for (const session of openSessions) {
    if (!sessionByTableNumber.has(session.tableNumber)) {
      sessionByTableNumber.set(session.tableNumber, session);
    }
  }

  const result = tables.map((table) => {
    const session = sessionByTableNumber.get(table.number);
    if (!session) {
      return {
        ...table,
        status: "LIBRE" as const,
        tableSessionId: null,
        waiterName: "",
        openOrdersCount: 0,
        total: 0,
      };
    }

    const billableOrders = session.orders.filter(
      (o) => o.status !== "CANCELLED",
    );
    if (billableOrders.length === 0) {
      // Sesión abierta pero sin ningún pedido facturable (p. ej. se
      // canceló el único pedido): se trata como libre a efectos del mapa.
      return {
        ...table,
        status: "LIBRE" as const,
        tableSessionId: session.id,
        waiterName: "",
        openOrdersCount: 0,
        total: 0,
      };
    }

    const total = billableOrders.reduce(
      (sum, o) =>
        sum + o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
      0,
    );
    const waiterName =
      session.orders[session.orders.length - 1]?.waiterName ?? "";

    return {
      ...table,
      status: deriveStatus(billableOrders),
      tableSessionId: session.id,
      waiterName,
      openOrdersCount: billableOrders.length,
      total: Math.round(total * 100) / 100,
    };
  });

  res.json(result);
});

tablesRouter.post("/instances/:instanceId/tables", async (req, res) => {
  const instanceId = Number(req.params.instanceId);
  await ensureServiceAccess(instanceId, "Mapa", req);

  const input = parseTableInput(req.body ?? {}, { partial: false });

  try {
    const table = await prisma.restaurantTable.create({
      data: {
        instanceId,
        number: input.number!,
        name: input.name ?? "",
        seats: input.seats!,
        shape: input.shape ?? "RECTANGLE",
        posRow: input.posRow!,
        posCol: input.posCol!,
        width: input.width!,
        height: input.height!,
      },
    });
    await publish(instanceId, { type: "table" });
    res.status(201).json(table);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new ApiError(
        409,
        `Ya existe una mesa con el número ${input.number}`,
      );
    }
    throw err;
  }
});

tablesRouter.put("/tables/:tableId", async (req, res) => {
  const tableId = Number(req.params.tableId);
  const existing = await prisma.restaurantTable.findUnique({
    where: { id: tableId },
  });
  if (!existing) throw new ApiError(404, "Mesa no encontrada");
  await ensureServiceAccess(existing.instanceId, "Mapa", req);

  const input = parseTableInput(req.body ?? {}, { partial: true });
  const { expectedUpdatedAt } = req.body ?? {};
  const staleMsg =
    "Esta mesa se modificó mientras tanto (otra persona la cambió). Recarga el mapa e inténtalo de nuevo.";

  // Si dos personas editan/arrastran la misma mesa del mapa a la vez, la
  // segunda escritura se rechaza en vez de pisar silenciosamente a la primera.
  checkNotStale(expectedUpdatedAt, existing.updatedAt, staleMsg);

  try {
    const updated = await prisma.$transaction(async (tx) => {
      await checkNotStaleInTx(
        () =>
          tx.restaurantTable.findUnique({
            where: { id: tableId },
            select: { updatedAt: true },
          }),
        expectedUpdatedAt,
        existing.updatedAt,
        staleMsg,
      );
      return tx.restaurantTable.update({ where: { id: tableId }, data: input });
    });
    await publish(existing.instanceId, { type: "table" });
    res.json(updated);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new ApiError(
        409,
        `Ya existe una mesa con el número ${input.number}`,
      );
    }
    throw err;
  }
});

tablesRouter.delete("/tables/:tableId", async (req, res) => {
  const tableId = Number(req.params.tableId);
  const existing = await prisma.restaurantTable.findUnique({
    where: { id: tableId },
  });
  if (!existing) throw new ApiError(404, "Mesa no encontrada");
  await ensureServiceAccess(existing.instanceId, "Mapa", req);
  await prisma.restaurantTable.delete({ where: { id: tableId } });

  const actorName = await resolveWaiterName(req);
  await logAudit({
    instanceId: existing.instanceId,
    action: "TABLE_DELETED",
    actorName,
    tableNumber: existing.number,
    summary: existing.name
      ? `Mesa ${existing.number} (${existing.name})`
      : `Mesa ${existing.number}`,
  });
  await publish(existing.instanceId, { type: "table" });
  res.status(204).end();
});

const AUDIT_LOG_LIMIT_DEFAULT = 50;
const AUDIT_LOG_LIMIT_MAX = 200;

// Histórico de operaciones irreversibles (cancelaciones, cierres…),
// opcionalmente filtrado por mesa — ver AuditLog en el schema.
tablesRouter.get("/instances/:instanceId/audit-log", async (req, res) => {
  const instanceId = Number(req.params.instanceId);
  await ensureServiceAccess(instanceId, ["Mapa", "Pedidos", "Analíticas"], req);

  const tableNumber =
    req.query.tableNumber !== undefined
      ? Number(req.query.tableNumber)
      : undefined;
  const limit = Math.min(
    AUDIT_LOG_LIMIT_MAX,
    Math.max(1, Number(req.query.limit) || AUDIT_LOG_LIMIT_DEFAULT),
  );

  const logs = await prisma.auditLog.findMany({
    where: {
      instanceId,
      ...(tableNumber !== undefined &&
        Number.isInteger(tableNumber) && { tableNumber }),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  res.json(logs);
});
