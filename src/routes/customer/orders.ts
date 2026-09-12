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
  await ensureInstanceAccess(Number(req.params.instanceId), req.userId);

  // El estado inicial siempre es PENDING ("Nuevos"): un pedido solo pasa a
  // cocina (IN_PROGRESS) cuando alguien pulsa explícitamente "Enviar a
  // cocina", nunca automáticamente al crearlo.
  const { tableNumber, notes, items, sendToKitchen } = req.body;
  if (!tableNumber || Number(tableNumber) <= 0) {
    throw new ApiError(400, "El número de mesa es requerido");
  }
  const parsedItems = parseOrderItems(items);
  // El camarero nunca se toma del formulario: se resuelve a partir de la
  // sesión que ha iniciado el pedido.
  const waiterName = await resolveWaiterName(req);

  const order = await prisma.order.create({
    data: {
      instanceId: Number(req.params.instanceId),
      tableNumber: Number(tableNumber),
      waiterName,
      notes: notes ?? "",
      status: sendToKitchen ? "IN_PROGRESS" : "PENDING",
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

ordersRouter.delete("/orders/:orderId", async (req, res) => {
  const orderId = Number(req.params.orderId);
  const existing = await prisma.order.findUnique({ where: { id: orderId } });
  if (!existing) throw new ApiError(404, "Pedido no encontrado");
  await ensureInstanceAccess(existing.instanceId, req.userId);
  await prisma.order.delete({ where: { id: orderId } });
  res.status(204).end();
});
