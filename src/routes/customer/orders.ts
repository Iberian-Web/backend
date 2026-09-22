import { Router } from "express";
import { OrderStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { ensureInstanceAccess } from "../../lib/access";
import { resolveWaiterName } from "../../middleware/session";

export const ordersRouter = Router();

type OrderItemInput = {
  dishName: string;
  quantity: number;
  unitPrice: number;
};

/** Valida y normaliza las líneas de un pedido recibidas en el body. */
function parseOrderItems(raw: unknown): OrderItemInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ApiError(400, "El pedido debe incluir al menos un plato");
  }
  return raw.map((item) => {
    const { dishName, quantity, unitPrice } = (item ?? {}) as Record<
      string,
      unknown
    >;
    if (typeof dishName !== "string" || !dishName.trim()) {
      throw new ApiError(400, "Cada plato del pedido necesita un nombre");
    }
    const qty = Number(quantity);
    const price = Number(unitPrice);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new ApiError(400, `Cantidad inválida para "${dishName}"`);
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new ApiError(400, `Precio inválido para "${dishName}"`);
    }
    return {
      dishName: dishName.trim(),
      quantity: Math.trunc(qty),
      unitPrice: price,
    };
  });
}

/** Añade el total calculado (suma de líneas) a un pedido antes de devolverlo. */
function withOrderTotal<
  T extends { items: { quantity: number; unitPrice: number }[] },
>(order: T) {
  const total = order.items.reduce(
    (sum, i) => sum + i.quantity * i.unitPrice,
    0,
  );
  return { ...order, total: Math.round(total * 100) / 100 };
}

/**
 * Busca la sesión de mesa abierta para esa mesa, o crea una nueva. Así todos
 * los pedidos de la mesa mientras siga abierta quedan agrupados en un único
 * ticket al cobrar.
 */
async function getOrOpenTableSession(instanceId: number, tableNumber: number) {
  const open = await prisma.tableSession.findFirst({
    where: { instanceId, tableNumber, closedAt: null },
    orderBy: { openedAt: "desc" },
  });
  if (open) return open;
  return prisma.tableSession.create({ data: { instanceId, tableNumber } });
}

// GET /api/instances/:instanceId/orders — filtro opcional ?status=PENDING
ordersRouter.get("/instances/:instanceId/orders", async (req, res) => {
  await ensureInstanceAccess(Number(req.params.instanceId), req.userId);

  const { status } = req.query;
  const orders = await prisma.order.findMany({
    where: {
      instanceId: Number(req.params.instanceId),
      ...(status && { status: status as OrderStatus }),
    },
    orderBy: { createdAt: "desc" },
    include: { items: { orderBy: { id: "asc" } } },
  });
  res.json(orders.map(withOrderTotal));
});

// GET /api/orders/:orderId — detalle de un único pedido (usado por la página de edición)
ordersRouter.get("/orders/:orderId", async (req, res) => {
  const orderId = Number(req.params.orderId);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { orderBy: { id: "asc" } } },
  });
  if (!order) throw new ApiError(404, "Pedido no encontrado");
  await ensureInstanceAccess(order.instanceId, req.userId);
  res.json(withOrderTotal(order));
});

ordersRouter.post("/instances/:instanceId/orders", async (req, res) => {
  const instanceId = Number(req.params.instanceId);
  await ensureInstanceAccess(instanceId, req.userId);

  // Todo pedido nuevo entra directamente en cocina (IN_PROGRESS): ya no
  // existe el paso intermedio de "Nuevo · sin enviar" (PENDING), que solo
  // añadía una acción manual sin aportar nada al flujo real de cocina.
  const { tableNumber, notes, items } = req.body;
  if (!tableNumber || Number(tableNumber) <= 0) {
    throw new ApiError(400, "El número de mesa es requerido");
  }
  const parsedItems = parseOrderItems(items);
  // El camarero nunca se toma del formulario: se resuelve a partir de la
  // sesión que ha iniciado el pedido.
  const waiterName = await resolveWaiterName(req);
  // Si la mesa ya tiene una sesión abierta (p. ej. ya se pidió comida y
  // ahora se añade el postre), el pedido se cuelga de esa misma sesión en
  // vez de abrir una nueva, para poder combinar la cuenta al cerrar mesa.
  const tableSession = await getOrOpenTableSession(
    instanceId,
    Number(tableNumber),
  );

  const order = await prisma.order.create({
    data: {
      instanceId,
      tableSessionId: tableSession.id,
      tableNumber: Number(tableNumber),
      waiterName,
      notes: notes ?? "",
      status: "IN_PROGRESS",
      items: { create: parsedItems },
    },
    include: { items: { orderBy: { id: "asc" } } },
  });
  res.status(201).json(withOrderTotal(order));
});

ordersRouter.put("/orders/:orderId", async (req, res) => {
  const orderId = Number(req.params.orderId);
  const existing = await prisma.order.findUnique({ where: { id: orderId } });
  if (!existing) throw new ApiError(404, "Pedido no encontrado");
  await ensureInstanceAccess(existing.instanceId, req.userId);

  const { tableNumber, notes, status, items } = req.body;
  const parsedItems = items !== undefined ? parseOrderItems(items) : undefined;

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      ...(tableNumber !== undefined && { tableNumber: Number(tableNumber) }),
      ...(notes !== undefined && { notes }),
      ...(status !== undefined && { status }),
      // Reemplaza todas las líneas del pedido si se envía `items` (modo edición completa)
      ...(parsedItems !== undefined && {
        items: { deleteMany: {}, create: parsedItems },
      }),
    },
    include: { items: { orderBy: { id: "asc" } } },
  });
  res.json(withOrderTotal(updated));
});

// GET /api/table-sessions/:sessionId — la sesión de mesa con todos sus
// pedidos combinados (para imprimir un único ticket con todo lo pedido por
// la mesa, no solo el último pedido).
ordersRouter.get("/table-sessions/:sessionId", async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const tableSession = await prisma.tableSession.findUnique({
    where: { id: sessionId },
    include: {
      orders: {
        orderBy: { createdAt: "asc" },
        include: { items: { orderBy: { id: "asc" } } },
      },
    },
  });
  if (!tableSession) throw new ApiError(404, "Sesión de mesa no encontrada");
  await ensureInstanceAccess(tableSession.instanceId, req.userId);

  // Los pedidos cancelados no cuentan para la cuenta combinada, igual que
  // en las analíticas de facturación.
  const billableOrders = tableSession.orders.filter(
    (o) => o.status !== "CANCELLED",
  );

  // Combina las líneas de todos los pedidos: mismo plato + mismo precio se
  // suma en una sola línea en vez de repetirse una vez por pedido.
  const combinedItems = new Map<
    string,
    { dishName: string; quantity: number; unitPrice: number }
  >();
  for (const order of billableOrders) {
    for (const item of order.items) {
      const key = `${item.dishName}::${item.unitPrice}`;
      const existing = combinedItems.get(key);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        combinedItems.set(key, {
          dishName: item.dishName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        });
      }
    }
  }
  const items = Array.from(combinedItems.values());
  const total = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const waiterName =
    tableSession.orders[tableSession.orders.length - 1]?.waiterName ?? "";
  const notes = billableOrders
    .map((o) => o.notes)
    .filter((n) => n.trim())
    .join(" · ");

  res.json({
    id: tableSession.id,
    instanceId: tableSession.instanceId,
    tableNumber: tableSession.tableNumber,
    waiterName,
    openedAt: tableSession.openedAt,
    closedAt: tableSession.closedAt,
    orders: tableSession.orders.map(withOrderTotal),
    items,
    notes,
    total: Math.round(total * 100) / 100,
  });
});

// PATCH /api/table-sessions/:sessionId/close — cierra la cuenta de la mesa.
// Solo si todos sus pedidos están en estado final (entregado o cancelado).
ordersRouter.patch("/table-sessions/:sessionId/close", async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const tableSession = await prisma.tableSession.findUnique({
    where: { id: sessionId },
    include: { orders: true },
  });
  if (!tableSession) throw new ApiError(404, "Sesión de mesa no encontrada");
  await ensureInstanceAccess(tableSession.instanceId, req.userId);

  if (tableSession.closedAt) {
    throw new ApiError(400, "Esta mesa ya está cerrada");
  }
  const stillActive = tableSession.orders.some((o) =>
    ["PENDING", "IN_PROGRESS", "READY"].includes(o.status),
  );
  if (stillActive) {
    throw new ApiError(
      400,
      "Todavía hay pedidos en curso en esta mesa: no se puede cerrar la cuenta",
    );
  }

  const updated = await prisma.tableSession.update({
    where: { id: sessionId },
    data: { closedAt: new Date() },
  });
  res.json(updated);
});

ordersRouter.delete("/orders/:orderId", async (req, res) => {
  const orderId = Number(req.params.orderId);
  const existing = await prisma.order.findUnique({ where: { id: orderId } });
  if (!existing) throw new ApiError(404, "Pedido no encontrado");
  await ensureInstanceAccess(existing.instanceId, req.userId);
  await prisma.order.delete({ where: { id: orderId } });
  res.status(204).end();
});
