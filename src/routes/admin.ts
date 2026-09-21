import { Router } from "express";
import { instanceWithDetails, prisma } from "../lib/prisma";
import { ApiError } from "../lib/errors";
import { ADMIN_COOKIE_NAME, clearCookieOptions } from "../lib/cookies";
import { requireSession } from "../middleware/session";
import { ensureCustomer } from "../lib/access";
import { DEFAULT_MENU_SECTIONS } from "../catalogue";
import { buildCreateData, buildUpdateData } from "../lib/customerInput";
import {
  createCredentials,
  syncCredentials,
  type CredentialInput,
} from "../lib/credentials";

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

const customerWithDetails = {
  credentials: { select: { id: true, name: true, username: true, role: true } },
  instances: { include: instanceWithDetails },
  documents: {
    select: {
      id: true,
      type: true,
      status: true,
      fileName: true,
      setupFee: true,
      notes: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  },
} as const;

adminRouter.get("/customers", async (_req, res) => {
  const customers = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: customerWithDetails,
  });
  res.json(customers);
});

adminRouter.get("/customers/:id", async (req, res) => {
  const customer = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: customerWithDetails,
  });
  if (!customer) throw new ApiError(404, "Cliente no encontrado");
  res.json(customer);
});

adminRouter.post("/customers", async (req, res) => {
  const rawCredentials = (req.body.credentials ?? []) as CredentialInput[];

  const customer = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({ data: buildCreateData(req.body) });
    const credentials = await createCredentials(tx, created.id, rawCredentials);
    return { ...created, credentials };
  });

  res.status(201).json(customer);
});

adminRouter.put("/customers/:id", async (req, res) => {
  await ensureCustomer(req.params.id);
  const rawCredentials = req.body.credentials as CredentialInput[] | undefined;

  const customer = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: req.params.id },
      data: buildUpdateData(req.body),
    });
    const credentials = Array.isArray(rawCredentials)
      ? await syncCredentials(tx, req.params.id, rawCredentials)
      : await tx.credential.findMany({
          where: { userId: req.params.id },
          select: { id: true, name: true, username: true, role: true },
        });
    return { ...updated, credentials };
  });

  res.json(customer);
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
  const deleted = await prisma.service.deleteMany({
    where: { id: Number(req.params.id) },
  });
  if (deleted.count === 0) throw new ApiError(404, "Servicio no encontrado");
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
  const deleted = await prisma.instance.deleteMany({
    where: { id: Number(req.params.instanceId) },
  });
  if (deleted.count === 0) throw new ApiError(404, "Instancia no encontrada");
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

// ── CREDENTIAL SERVICES (permisos por usuario del portal) ────────────────
// Sin fila en CredentialService = servicio habilitado (opt-out): sólo se
// guarda una fila cuando se le quita a un usuario un servicio que su
// contrato sí tiene activo.

adminRouter.get("/credentials/:credentialId/services", async (req, res) => {
  const credential = await prisma.credential.findUnique({
    where: { id: req.params.credentialId },
    select: { userId: true },
  });
  if (!credential) throw new ApiError(404, "Usuario no encontrado");

  const [activeServices, overrides] = await Promise.all([
    prisma.instanceService.findMany({
      where: { active: true, instance: { userId: credential.userId } },
      include: { service: { include: { application: true } } },
    }),
    prisma.credentialService.findMany({
      where: { credentialId: req.params.credentialId },
    }),
  ]);

  const overrideMap = new Map(overrides.map((o) => [o.serviceId, o.enabled]));
  const seen = new Set<number>();
  const result = activeServices
    .filter((is) => (seen.has(is.serviceId) ? false : seen.add(is.serviceId)))
    .map((is) => ({
      serviceId: is.serviceId,
      name: is.service.name,
      applicationName: is.service.application.name,
      enabled: overrideMap.get(is.serviceId) ?? true,
    }));
  res.json(result);
});

adminRouter.put(
  "/credentials/:credentialId/services/:serviceId",
  async (req, res) => {
    const { credentialId } = req.params;
    const serviceId = Number(req.params.serviceId);
    const { enabled } = req.body;
    if (typeof enabled !== "boolean") {
      throw new ApiError(400, "enabled debe ser booleano");
    }

    const row = await prisma.credentialService.upsert({
      where: { credentialId_serviceId: { credentialId, serviceId } },
      update: { enabled },
      create: { credentialId, serviceId, enabled },
    });
    res.json(row);
  },
);
