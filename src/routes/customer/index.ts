import { Router } from "express";
import { instanceWithDetails, prisma } from "../../lib/prisma";
import { CUSTOMER_COOKIE_NAME, clearCookieOptions } from "../../lib/cookies";
import { requireSession, resolveWaiterName } from "../../middleware/session";
import { menusRouter } from "./menus";
import { reservationsRouter } from "./reservations";
import { ordersRouter } from "./orders";

export const customerRouter = Router();
customerRouter.use(requireSession(CUSTOMER_COOKIE_NAME, { customer: true }));

customerRouter.post("/customer-auth/logout", async (req, res) => {
  const token = req.cookies?.[CUSTOMER_COOKIE_NAME];
  if (token) await prisma.session.deleteMany({ where: { token } });
  res.clearCookie(CUSTOMER_COOKIE_NAME, clearCookieOptions());
  res.status(204).end();
});

customerRouter.get("/customer-auth/me", (req, res) => {
  res.json({ authenticated: true, userId: req.userId });
});

customerRouter.get("/portal/my-access", async (req, res) => {
  const customer = await prisma.user.findUniqueOrThrow({
    where: { id: req.userId! },
    include: { instances: { include: instanceWithDetails } },
  });
  const waiterName = await resolveWaiterName(req);
  res.json({ ...customer, waiterName });
});

customerRouter.use(menusRouter);
customerRouter.use(reservationsRouter);
customerRouter.use(ordersRouter);
