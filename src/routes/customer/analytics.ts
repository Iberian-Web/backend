// backend/src/routes/customer/analytics.ts
import { Router } from "express";
import { OrderStatus, ReservationStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { ensureServiceAccess } from "../../lib/access";
import { renderMonthlyAnalyticsPdf } from "../../lib/pdf/monthlyReport";

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

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Capitaliza solo la primera letra ("septiembre" → "Septiembre"), sin tocar el resto. */
function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

type Period = {
  from: Date;
  to: Date; // exclusivo
  label: string; // "septiembre de 2026" o "5 de septiembre de 2026"
  month: string; // "2026-09", siempre presente (para el selector de mes del frontend)
  granularity: "month" | "day";
  isCurrentMonth: boolean;
};

/**
 * Resuelve qué periodo pide el cliente: un día concreto (`day=YYYY-MM-DD`),
 * un mes natural concreto (`month=YYYY-MM`), o —por defecto, si no se manda
 * nada— el mes natural en curso. Todo en huso horario LOCAL del servidor,
 * igual que `localDateKey`.
 */
function resolvePeriod(query: Record<string, unknown>): Period {
  const dayParam = typeof query.day === "string" ? query.day : undefined;
  const monthParam = typeof query.month === "string" ? query.month : undefined;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (dayParam !== undefined) {
    const match = DAY_RE.exec(dayParam);
    if (!match)
      throw new ApiError(400, "Parámetro 'day' inválido (usa YYYY-MM-DD)");
    const [, y, m, d] = match;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    const from = new Date(year, month - 1, day);
    if (Number.isNaN(from.getTime()) || from.getMonth() !== month - 1) {
      throw new ApiError(400, "Fecha 'day' inválida");
    }
    const to = new Date(year, month - 1, day + 1);
    return {
      from,
      to,
      label: from.toLocaleDateString("es-ES", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      month: `${y}-${m}`,
      granularity: "day",
      isCurrentMonth: year === currentYear && month === currentMonth,
    };
  }

  let year: number;
  let month: number; // 1-12
  if (monthParam !== undefined) {
    const match = MONTH_RE.exec(monthParam);
    if (!match)
      throw new ApiError(400, "Parámetro 'month' inválido (usa YYYY-MM)");
    year = Number(match[1]);
    month = Number(match[2]);
    if (month < 1 || month > 12) {
      throw new ApiError(
        400,
        "Parámetro 'month' inválido (mes fuera de rango)",
      );
    }
  } else {
    year = currentYear;
    month = currentMonth;
  }

  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 1); // día 1 del mes siguiente, exclusivo
  return {
    from,
    to,
    // "Septiembre 2026", sin el "de" que añade toLocaleDateString al
    // combinar month+year, y capitalizado a mano.
    label: `${capitalize(from.toLocaleDateString("es-ES", { month: "long" }))} ${year}`,
    month: `${year}-${String(month).padStart(2, "0")}`,
    granularity: "month",
    isCurrentMonth: year === currentYear && month === currentMonth,
  };
}

/** Todos los días entre `from` (incluido) y `to` (excluido), como claves locales YYYY-MM-DD. */
function daysInPeriod(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(from);
  while (cursor < to) {
    days.push(localDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * Calcula todo el resumen de analíticas (ingresos, pedidos, platos,
 * reservas) para una instancia, acotado a un periodo natural concreto —
 * compartido por el endpoint JSON del dashboard y el del PDF descargable,
 * para que ambos digan siempre exactamente lo mismo.
 */
async function buildAnalyticsSummary(instanceId: number, period: Period) {
  const [orders, reservations] = await Promise.all([
    prisma.order.findMany({
      where: { instanceId, createdAt: { gte: period.from, lt: period.to } },
      include: { items: true },
    }),
    prisma.reservation.findMany({
      where: {
        instanceId,
        reservationDate: { gte: period.from, lt: period.to },
      },
    }),
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

  const ordersByStatus = zeroCountByStatus(ORDER_STATUSES);
  for (const o of orders) ordersByStatus[o.status]++;

  // Serie diaria: un punto por cada día natural del periodo (para un mes,
  // de 28 a 31 días; para un día concreto, un único punto).
  const dailyMap = new Map<string, { orders: number; revenue: number }>();
  for (const key of daysInPeriod(period.from, period.to)) {
    dailyMap.set(key, { orders: 0, revenue: 0 });
  }
  for (const o of billableOrders) {
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

  // Platos más pedidos (por unidades, sobre pedidos no cancelados del periodo)
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

  return {
    revenue: {
      total: Math.round(revenueTotal * 100) / 100,
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
  };
}

/** "Facturado hoy": siempre sobre el día real de hoy, independientemente del
 *  periodo/mes que se esté consultando en el resto del resumen — es un
 *  indicador en vivo, no una cifra del informe histórico. */
async function revenueToday(instanceId: number): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const orders = await prisma.order.findMany({
    where: {
      instanceId,
      status: "DELIVERED",
      createdAt: { gte: start, lt: end },
    },
    include: { items: true },
  });
  const total = orders.reduce(
    (sum, o) => sum + o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
    0,
  );
  return Math.round(total * 100) / 100;
}

/** Mes natural ("YYYY-MM") de alta de la instancia: no hay datos anteriores. */
function earliestMonthKey(contractDate: Date): string {
  return `${contractDate.getFullYear()}-${String(contractDate.getMonth() + 1).padStart(2, "0")}`;
}

// GET /api/instances/:instanceId/analytics?month=YYYY-MM | ?day=YYYY-MM-DD
// Resumen para el restaurante, acotado al mes natural indicado (o al mes en
// curso si no se manda nada), o a un día concreto con ?day=.
analyticsRouter.get("/instances/:instanceId/analytics", async (req, res) => {
  const instanceId = Number(req.params.instanceId);
  await ensureServiceAccess(instanceId, "Analíticas", req);

  const period = resolvePeriod(req.query as Record<string, unknown>);
  const [summary, today, instance] = await Promise.all([
    buildAnalyticsSummary(instanceId, period),
    revenueToday(instanceId),
    prisma.instance.findUnique({
      where: { id: instanceId },
      select: { contractDate: true },
    }),
  ]);
  if (!instance) throw new ApiError(404, "Instancia no encontrada");

  res.json({
    period: {
      granularity: period.granularity,
      month: period.month,
      label: period.label,
      from: localDateKey(period.from),
      to: localDateKey(new Date(period.to.getTime() - 1)),
      isCurrentMonth: period.isCurrentMonth,
      // Mes más antiguo hasta el que se puede retroceder con el selector
      // (el mes de alta del cliente): antes de eso no puede haber datos.
      earliestMonth: earliestMonthKey(instance.contractDate),
    },
    revenue: { ...summary.revenue, today },
    orders: summary.orders,
    topDishes: summary.topDishes,
    reservations: summary.reservations,
  });
});

// GET /api/instances/:instanceId/analytics/pdf?month=YYYY-MM — informe
// completo del mes natural seleccionado (o el mes en curso por defecto) en
// PDF descargable, con el mismo resumen que ve el restaurante en pantalla.
analyticsRouter.get(
  "/instances/:instanceId/analytics/pdf",
  async (req, res) => {
    const instanceId = Number(req.params.instanceId);
    await ensureServiceAccess(instanceId, "Analíticas", req);

    // El informe descargable siempre es de un mes natural completo (no de
    // un solo día): un `day=` en la query, si llegara, se ignora aquí.
    const period = resolvePeriod({ month: req.query.month });

    const [summary, today, instance] = await Promise.all([
      buildAnalyticsSummary(instanceId, period),
      revenueToday(instanceId),
      prisma.instance.findUnique({
        where: { id: instanceId },
        include: { user: true },
      }),
    ]);
    if (!instance) throw new ApiError(404, "Instancia no encontrada");

    const restaurantName =
      instance.user.company.trim() ||
      instance.user.name.trim() ||
      "Restaurante";

    const pdf = await renderMonthlyAnalyticsPdf({
      restaurantName,
      restaurantAddress: instance.user.address.trim() || undefined,
      periodLabel: period.label,
      generatedAt: new Date(),
      revenue: { ...summary.revenue, today },
      ordersTotal: summary.orders.total,
      ordersByStatus: summary.orders.byStatus,
      reservationsTotal: summary.reservations.total,
      reservationsByStatus: summary.reservations.byStatus,
      reservationsTotalGuests: summary.reservations.totalGuests,
      reservationsNoShowRate: summary.reservations.noShowRate,
      topDishes: summary.topDishes,
      dailySeries: summary.orders.dailySeries,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="informe-${period.month}.pdf"`,
    );
    res.send(pdf);
  },
);
