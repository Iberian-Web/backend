import { Router } from "express";
import { ReservationStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { ensureInstanceAccess } from "../../lib/access";

export const reservationsRouter = Router();

// GET /api/instances/:instanceId/reservations — filtros opcionales ?date=YYYY-MM-DD ?status=PENDING
reservationsRouter.get(
  "/instances/:instanceId/reservations",
  async (req, res) => {
    await ensureInstanceAccess(Number(req.params.instanceId), req.userId);

    const { date, status } = req.query;
    let dateFilter: { gte: Date; lt: Date } | undefined;
    if (typeof date === "string" && date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      dateFilter = { gte: start, lt: end };
    }

    const reservations = await prisma.reservation.findMany({
      where: {
        instanceId: Number(req.params.instanceId),
        ...(dateFilter && { reservationDate: dateFilter }),
        ...(status && { status: status as ReservationStatus }),
      },
      orderBy: { reservationDate: "asc" },
    });
    res.json(reservations);
  },
);

reservationsRouter.post(
  "/instances/:instanceId/reservations",
  async (req, res) => {
    await ensureInstanceAccess(Number(req.params.instanceId), req.userId);

    const {
      customerName,
      customerPhone,
      customerEmail,
      reservationDate,
      guests,
      notes,
    } = req.body;
    if (!customerName || !customerPhone || !reservationDate || !guests) {
      throw new ApiError(
        400,
        "customerName, customerPhone, reservationDate y guests son requeridos",
      );
    }

    const reservation = await prisma.reservation.create({
      data: {
        instanceId: Number(req.params.instanceId),
        customerName,
        customerPhone,
        customerEmail: customerEmail ?? "",
        reservationDate: new Date(reservationDate),
        guests: Number(guests),
        notes: notes ?? "",
        status: "PENDING",
      },
    });
    res.status(201).json(reservation);
  },
);

reservationsRouter.put("/reservations/:reservationId", async (req, res) => {
  const reservationId = Number(req.params.reservationId);
  const existing = await prisma.reservation.findUnique({
    where: { id: reservationId },
  });
  if (!existing) throw new ApiError(404, "Reserva no encontrada");
  await ensureInstanceAccess(existing.instanceId, req.userId);

  const {
    customerName,
    customerPhone,
    customerEmail,
    reservationDate,
    guests,
    notes,
    status,
  } = req.body;
  const updated = await prisma.reservation.update({
    where: { id: reservationId },
    data: {
      ...(customerName !== undefined && { customerName }),
      ...(customerPhone !== undefined && { customerPhone }),
      ...(customerEmail !== undefined && { customerEmail }),
      ...(reservationDate !== undefined && {
        reservationDate: new Date(reservationDate),
      }),
      ...(guests !== undefined && { guests: Number(guests) }),
      ...(notes !== undefined && { notes }),
      ...(status !== undefined && { status }),
    },
  });
  res.json(updated);
});

reservationsRouter.delete("/reservations/:reservationId", async (req, res) => {
  const reservationId = Number(req.params.reservationId);
  const existing = await prisma.reservation.findUnique({
    where: { id: reservationId },
  });
  if (!existing) throw new ApiError(404, "Reserva no encontrada");
  await ensureInstanceAccess(existing.instanceId, req.userId);
  await prisma.reservation.delete({ where: { id: reservationId } });
  res.status(204).end();
});
