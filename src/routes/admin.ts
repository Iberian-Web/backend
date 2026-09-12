import bcrypt from "bcrypt";
import { Router } from "express";
import { instanceWithDetails, prisma } from "../lib/prisma";
import { ApiError } from "../lib/errors";
import { ADMIN_COOKIE_NAME, clearCookieOptions } from "../lib/cookies";
import { requireSession } from "../middleware/session";
import { ensureCustomer } from "../lib/access";
import { DEFAULT_MENU_SECTIONS } from "../catalogue";

const SALT_ROUNDS = 10;

type NewCredentialInput = { name?: string; username: string; password: string };
type CredentialUpdateInput = {
  id?: string;
  name?: string;
  username: string;
  password?: string;
};

export const adminRouter = Router();
adminRouter.use(requireSession(ADMIN_COOKIE_NAME, { customer: false }));

adminRouter.post("/auth/logout", async (req, res) => {
  const token = req.cookies?.[ADMIN_COOKIE_NAME];
  if (token) await prisma.session.deleteMany({ where: { token } });
  res.clearCookie(ADMIN_COOKIE_NAME, clearCookieOptions());
  res.status(204).end();
});

adminRouter.get("/auth/me", (_req, res) => {
  res.json({ authenticated: true });
});

// ── CUSTOMERS ────────────────────────────────────────────────────────────

adminRouter.get("/customers", async (_req, res) => {
  const customers = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      credentials: { select: { id: true, name: true, username: true } },
      instances: { include: instanceWithDetails },
    },
  });
  res.json(customers);
});

adminRouter.get("/customers/:id", async (req, res) => {
  const customer = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: {
      credentials: { select: { id: true, name: true, username: true } },
      instances: { include: instanceWithDetails },
    },
  });
  if (!customer) throw new ApiError(404, "Cliente no encontrado");
  res.json(customer);
});

adminRouter.post("/customers", async (req, res) => {
  const {
    dni,
    name,
    email,
    company,
    domains,
    status,
    phone,
    address,
    credentials,
  } = req.body;
  const customer = await prisma.user.create({
    data: {
      dni,
      name,
      email,
      company: company ?? "",
      domains: domains ?? [],
      status: status ?? "PENDING",
      phone: phone ?? "",
      address: address ?? "",
    },
  });
  const createdCredentials = await prisma.credential.createManyAndReturn({
    data: (credentials ?? []).map((credential: NewCredentialInput) => ({
      userId: customer.id,
      name: credential.name ?? "",
      username: credential.username,
      password: bcrypt.hashSync(credential.password, SALT_ROUNDS),
    })),
    select: { id: true, name: true, username: true },
  });
  res.status(201).json({ ...customer, credentials: createdCredentials });
});

adminRouter.put("/customers/:id", async (req, res) => {
  const {
    dni,
    name,
    email,
    company,
    domains,
    status,
    phone,
    address,
    credentials,
  } = req.body;

  const customerExists = await prisma.user.findFirst({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!customerExists) throw new ApiError(404, "Cliente no encontrado");

  const customer = await prisma.$transaction(async (tx) => {
    const updatedCustomer = await tx.user.update({
      where: { id: req.params.id },
      data: {
        ...(dni !== undefined && { dni }),
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(company !== undefined && { company: company ?? "" }),
        ...(domains !== undefined && { domains: domains ?? [] }),
        ...(status !== undefined && { status }),
        ...(phone !== undefined && { phone: phone ?? "" }),
        ...(address !== undefined && { address: address ?? "" }),
      },
    });

    if (Array.isArray(credentials)) {
      const existing = await tx.credential.findMany({
        where: { userId: req.params.id },
      });
      const retainedIds = (credentials as CredentialUpdateInput[])
        .map((c) => c.id)
        .filter((id): id is string => Boolean(id));

      await tx.credential.deleteMany({
        where: { userId: req.params.id, id: { notIn: retainedIds } },
      });

      for (const credential of credentials as CredentialUpdateInput[]) {
        if (
          credential.id &&
          existing.some((item) => item.id === credential.id)
        ) {
          await tx.credential.update({
            where: { id: credential.id },
            data: {
              name: credential.name ?? "",
              username: credential.username,
              ...(credential.password && {
                password: await bcrypt.hash(credential.password, SALT_ROUNDS),
              }),
            },
          });
        } else {
          await tx.credential.create({
            data: {
              userId: req.params.id,
              name: credential.name ?? "",
              username: credential.username,
              password: await bcrypt.hash(
                credential.password ?? "",
                SALT_ROUNDS,
              ),
            },
          });
        }
      }
    }

    return updatedCustomer;
  });

  const savedCredentials = await prisma.credential.findMany({
    where: { userId: customer.id },
    select: { id: true, name: true, username: true },
  });
  res.json({ ...customer, credentials: savedCredentials });
});

adminRouter.delete("/customers/:id", async (req, res) => {
  const deleted = await prisma.user.deleteMany({
    where: { id: req.params.id },
  });
  if (deleted.count === 0) throw new ApiError(404, "Cliente no encontrado");
  res.status(204).end();
});

// ── APPLICATIONS (solo lectura + precio de servicios) ───────────────────

adminRouter.get("/applications", async (_req, res) => {
  const apps = await prisma.application.findMany({
    orderBy: { id: "asc" },
    include: { services: { orderBy: { id: "asc" } } },
  });
  res.json(apps);
});

adminRouter.post("/applications/:id/services", async (req, res) => {
  const { name, description, price } = req.body;
  if (typeof name !== "string" || !name.trim()) {
    throw new ApiError(400, "El nombre del servicio es obligatorio");
  }
  const service = await prisma.service.create({
    data: {
      applicationId: Number(req.params.id),
      name: name.trim(),
      description: description ?? "",
      price: price ?? "",
    },
  });
  res.status(201).json(service);
});

adminRouter.put("/services/:id", async (req, res) => {
  const { name, description, price } = req.body;
  const service = await prisma.service.update({
    where: { id: Number(req.params.id) },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(price !== undefined && { price }),
    },
  });
  res.json(service);
});

adminRouter.delete("/services/:id", async (req, res) => {
  await prisma.service.delete({ where: { id: Number(req.params.id) } });
  res.status(204).end();
});

// ── CUSTOMER INSTANCES ────────────────────────────────────────────────────

adminRouter.get("/customers/:id/instances", async (req, res) => {
  await ensureCustomer(req.params.id);
  const instances = await prisma.instance.findMany({
    where: { userId: req.params.id },
    include: instanceWithDetails,
  });
  res.json(instances);
});

adminRouter.post("/customers/:id/instances", async (req, res) => {
  await ensureCustomer(req.params.id);
  const { applicationId } = req.body;
  const [application, services] = await Promise.all([
    prisma.application.findUnique({ where: { id: Number(applicationId) } }),
    prisma.service.findMany({
      where: { applicationId: Number(applicationId) },
    }),
  ]);
  const instance = await prisma.instance.create({
    data: {
      userId: req.params.id,
      applicationId: Number(applicationId),
      instanceServices: {
        create: services.map((s) => ({
          serviceId: s.id,
          active: false,
          priceOverride: "",
        })),
      },
      // Un restaurante nuevo arranca con el set de secciones de carta
      // habitual (Entrante, Principal...); luego se puede editar libremente.
      ...(application?.name === "Restaurante" && {
        menuSections: {
          create: DEFAULT_MENU_SECTIONS.map((name, position) => ({
            name,
            position,
          })),
        },
      }),
    },
    include: instanceWithDetails,
  });
  res.status(201).json(instance);
});

adminRouter.post("/instances/:instanceId/payment", async (req, res) => {
  const instanceId = Number(req.params.instanceId);
  const { note } = req.body;
  const paidAt = new Date();

  const [, instance] = await prisma.$transaction([
    prisma.payment.create({ data: { instanceId, paidAt, note: note ?? "" } }),
    prisma.instance.update({
      where: { id: instanceId },
      data: { lastPaymentDate: paidAt },
      include: instanceWithDetails,
    }),
  ]);
  res.json(instance);
});

adminRouter.get("/instances/:instanceId/payments", async (req, res) => {
  const payments = await prisma.payment.findMany({
    where: { instanceId: Number(req.params.instanceId) },
    orderBy: { paidAt: "desc" },
  });
  res.json(payments);
});

adminRouter.delete("/payments/:paymentId", async (req, res) => {
  const deleted = await prisma.payment.deleteMany({
    where: { id: Number(req.params.paymentId) },
  });
  if (deleted.count === 0) throw new ApiError(404, "Pago no encontrado");
  res.status(204).end();
});

adminRouter.put("/instances/:instanceId/billing", async (req, res) => {
  const { billingFrequency, billingDay, billingStartDate } = req.body;
  const instance = await prisma.instance.update({
    where: { id: Number(req.params.instanceId) },
    data: {
      ...(billingFrequency !== undefined && { billingFrequency }),
      ...(billingDay !== undefined && { billingDay: Number(billingDay) }),
      ...(billingStartDate !== undefined && {
        billingStartDate: billingStartDate ? new Date(billingStartDate) : null,
      }),
    },
    include: instanceWithDetails,
  });
  res.json(instance);
});

adminRouter.delete("/instances/:instanceId", async (req, res) => {
  await prisma.instance.delete({
    where: { id: Number(req.params.instanceId) },
  });
  res.status(204).end();
});

// ── INSTANCE SERVICES ─────────────────────────────────────────────────────

adminRouter.get("/instances/:instanceId/services", async (req, res) => {
  const rows = await prisma.instanceService.findMany({
    where: { instanceId: Number(req.params.instanceId) },
    include: { service: true },
  });
  res.json(rows);
});

adminRouter.put(
  "/instances/:instanceId/services/:serviceId",
  async (req, res) => {
    const instanceId = Number(req.params.instanceId);
    const serviceId = Number(req.params.serviceId);
    const { active, priceOverride } = req.body;

    const row = await prisma.instanceService.upsert({
      where: { instanceId_serviceId: { instanceId, serviceId } },
      update: {
        ...(active !== undefined && { active }),
        ...(priceOverride !== undefined && { priceOverride }),
      },
      create: {
        instanceId,
        serviceId,
        active: active ?? false,
        priceOverride: priceOverride ?? "",
      },
      include: { service: true },
    });
    res.json(row);
  },
);
