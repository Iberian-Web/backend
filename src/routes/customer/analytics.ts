// backend/src/routes/customer/analytics.ts
import { Router } from "express";
import { OrderStatus, ReservationStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ensureInstanceAccess } from "../../lib/access";

export const analyticsRouter = Router();

const ORDER_STATUSES: OrderStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "READY",
  "DELIVERED",
  "CANCELLED",
];
const RESERVATION_STATUSES: ReservationStatus[] = [
  "PENDING",
  "CONFIRMED",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
];

function zeroCountByStatus<T extends string>(statuses: T[]) {
  return Object.fromEntries(statuses.map((s) => [s, 0])) as Record<T, number>;
}

/** Clave YYYY-MM-DD en huso horario LOCAL (no UTC): usar toISOString().slice(0, 10)
 *  desplazaría pedidos cercanos a medianoche al día equivocado según el huso
 *  horario del servidor frente a lo que ve el restaurante en el resto de la app. */
function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// GET /api/instances/:instanceId/analytics — resumen general para el restaurante
analyticsRouter.get("/instances/:instanceId/analytics", async (req, res) => {
  const instanceId = Number(req.params.instanceId);
  await ensureInstanceAccess(instanceId, req.userId);

  const since = new Date();
  since.setDate(since.getDate() - 29); // últimos 30 días (incluido hoy)
  since.setHours(0, 0, 0, 0);

  const [orders, reservations] = await Promise.all([
    prisma.order.findMany({
      where: { instanceId },
      include: { items: true },
    }),
    prisma.reservation.findMany({ where: { instanceId } }),
  ]);

  // ── Pedidos e ingresos ──────────────────────────────────────────────────
  const billableOrders = orders.filter((o) => o.status !== "CANCELLED");
  const orderTotal = (o: (typeof orders)[number]) =>
    o.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

  const revenueTotal = billableOrders.reduce(
    (sum, o) => sum + orderTotal(o),
    0,
  );
  const averageOrderValue = billableOrders.length
    ? revenueTotal / billableOrders.length
    : 0;

  // Facturado hoy: solo pedidos ya entregados (no basta con estar en curso)
  // creados hoy.
  const todayKey = localDateKey(new Date());
  const revenueToday = billableOrders
    .filter(
      (o) => o.status === "DELIVERED" && localDateKey(o.createdAt) === todayKey,
    )
    .reduce((sum, o) => sum + orderTotal(o), 0);

  const ordersByStatus = zeroCountByStatus(ORDER_STATUSES);
  for (const o of orders) ordersByStatus[o.status]++;

  // Serie de los últimos 30 días (pedidos y facturación por día)
  const dailyMap = new Map<string, { orders: number; revenue: number }>();
  for (let i = 0; i < 30; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    dailyMap.set(localDateKey(d), { orders: 0, revenue: 0 });
  }
  for (const o of billableOrders) {
    if (o.createdAt < since) continue;
    const key = localDateKey(o.createdAt);
    const bucket = dailyMap.get(key);
    if (bucket) {
      bucket.orders++;
      bucket.revenue += orderTotal(o);
    }
  }
  const dailySeries = Array.from(dailyMap.entries()).map(([date, v]) => ({
    date,
    orders: v.orders,
    revenue: Math.round(v.revenue * 100) / 100,
  }));

  // Platos más pedidos (por unidades, sobre pedidos no cancelados)
  const dishMap = new Map<string, { quantity: number; revenue: number }>();
  for (const o of billableOrders) {
    for (const item of o.items) {
      const bucket = dishMap.get(item.dishName) ?? { quantity: 0, revenue: 0 };
      bucket.quantity += item.quantity;
      bucket.revenue += item.quantity * item.unitPrice;
      dishMap.set(item.dishName, bucket);
    }
  }
  const topDishes = Array.from(dishMap.entries())
    .map(([name, v]) => ({
      name,
      quantity: v.quantity,
      revenue: Math.round(v.revenue * 100) / 100,
    }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5);

  // ── Reservas ─────────────────────────────────────────────────────────────
  const reservationsByStatus = zeroCountByStatus(RESERVATION_STATUSES);
  for (const r of reservations) reservationsByStatus[r.status]++;

  const now = new Date();
  const upcomingReservations = reservations.filter(
    (r) =>
      r.reservationDate >= now &&
      (r.status === "PENDING" || r.status === "CONFIRMED"),
  ).length;
  const totalGuests = reservations
    .filter((r) => r.status !== "CANCELLED" && r.status !== "NO_SHOW")
    .reduce((sum, r) => sum + r.guests, 0);
  const noShowRate = reservations.length
    ? reservationsByStatus.NO_SHOW / reservations.length
    : 0;

  res.json({
    revenue: {
      total: Math.round(revenueTotal * 100) / 100,
      today: Math.round(revenueToday * 100) / 100,
      averageOrderValue: Math.round(averageOrderValue * 100) / 100,
    },
    orders: {
      total: orders.length,
      byStatus: ordersByStatus,
      dailySeries,
    },
    topDishes,
    reservations: {
      total: reservations.length,
      byStatus: reservationsByStatus,
      upcoming: upcomingReservations,
      totalGuests,
      noShowRate: Math.round(noShowRate * 1000) / 1000,
    },
  });
});
