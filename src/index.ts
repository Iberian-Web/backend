import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import crypto from "crypto";
import bcrypt from "bcrypt";
import cookieParser from "cookie-parser";
import { PrismaClient, ReservationStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const app = express();
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
const port = process.env.PORT || 3001;

// ─────────────────────────────────────────────────────────────────────────────
// CORS
// ─────────────────────────────────────────────────────────────────────────────

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Peticiones sin Origin (curl, health checks, server-to-server) se permiten.
      if (
        !origin ||
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin)
      ) {
        callback(null, true);
        return;
      }
      callback(new Error("No permitido por CORS"));
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

// ─────────────────────────────────────────────────────────────────────────────
// Constantes compartidas
// ─────────────────────────────────────────────────────────────────────────────

const TOKEN_EXPIRATION_HOURS = 24;
const ADMIN_COOKIE_NAME = "admin_session_token";
const CUSTOMER_COOKIE_NAME = "customer_session_token";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SALT_ROUNDS = 10;

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  throw new Error("ADMIN_USERNAME y ADMIN_PASSWORD son obligatorios");
}

// En producción el frontend vive en otro dominio (Cloudflare Pages), por lo
// que la petición es "cross-site": la cookie necesita SameSite=None + Secure
// (Secure es obligatorio en cuanto SameSite es "none", exige HTTPS en el backend).
// En local (mismo origen vía proxy de Vite) "lax" + no-secure sigue funcionando.
const cookieOptions = (maxAgeMs: number) => ({
  httpOnly: true,
  secure: IS_PRODUCTION,
  sameSite: (IS_PRODUCTION ? "none" : "lax") as "none" | "lax",
  maxAge: maxAgeMs,
});
const clearCookieOptions = () => ({
  httpOnly: true,
  secure: IS_PRODUCTION,
  sameSite: (IS_PRODUCTION ? "none" : "lax") as "none" | "lax",
});

// `include` de instancia reutilizado en customers, instances y payment.
const instanceWithDetails = {
  application: { include: { services: true } },
  instanceServices: { include: { service: true } },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Error de API con status HTTP — evita comparar err.message por texto
// ─────────────────────────────────────────────────────────────────────────────

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function requireCredentials(body: unknown): {
  username: string;
  password: string;
} {
  const values =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const { username, password } = values;
  if (typeof username !== "string" || typeof password !== "string") {
    throw new ApiError(400, "Username y password son requeridos");
  }
  return { username, password };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sesión — helper de auth reutilizado por el router de admin y el de cliente
// ─────────────────────────────────────────────────────────────────────────────

function requireSession(cookieName: string, opts: { customer: boolean }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[cookieName];
    if (!token) {
      throw new ApiError(401, "Token de autenticación requerido");
    }

    const session = await prisma.session.findUnique({ where: { token } });
    if (!session || session.expiresAt < new Date()) {
      if (session) await prisma.session.delete({ where: { id: session.id } });
      res.clearCookie(cookieName, clearCookieOptions());
      throw new ApiError(401, "Token inválido o expirado");
    }
    if (opts.customer && !session.userId) {
      throw new ApiError(403, "Sesión de cliente requerida");
    }
    if (!opts.customer && session.userId) {
      throw new ApiError(403, "Sesión de administrador requerida");
    }

    if (session.userId) req.userId = session.userId;
    next();
  };
}

async function ensureInstanceAccess(instanceId: number, userId?: string) {
  const instance = await prisma.instance.findFirst({
    where: { id: instanceId, ...(userId ? { userId } : {}) },
  });
  if (!instance) {
    throw new ApiError(
      userId ? 403 : 404,
      userId ? "Acceso denegado." : "Instancia no encontrada.",
    );
  }
  return instance;
}

async function ensureCustomer(id: string) {
  const customer = await prisma.user.findFirst({
    where: { id },
    select: { id: true },
  });
  if (!customer) throw new ApiError(404, "Cliente no encontrado");
}

// ─────────────────────────────────────────────────────────────────────────────
// APPLICATION CATALOGUE
// Add new apps here and restart the server — syncApplications() handles the rest.
// Never add/remove from the UI; this is the single source of truth.
// ─────────────────────────────────────────────────────────────────────────────

const APP_CATALOGUE = [
  {
    name: "Restaurante",
    icon: "restaurant",
    color: "text-orange-400",
    services: [
      { name: "Menú Digital", price: "19.99" },
      { name: "Pedidos", price: "59.99" },
      { name: "Reservas", price: "49.99" },
    ],
  },
  {
    name: "Inmobiliaria",
    icon: "realestate",
    color: "text-sky-400",
    services: [{ name: "Manager", price: "99.99" }],
  },
] as const;

async function syncApplications() {
  console.log("🔄 Sincronizando catálogo de aplicaciones…");
  for (const appDef of APP_CATALOGUE) {
    const app = await prisma.application.upsert({
      where: { name: appDef.name },
      update: { icon: appDef.icon, color: appDef.color },
      create: { name: appDef.name, icon: appDef.icon, color: appDef.color },
    });
    for (const svcDef of appDef.services) {
      const existing = await prisma.service.findFirst({
        where: { applicationId: app.id, name: svcDef.name },
      });
      if (!existing) {
        // Solo se crea si falta — nunca se pisa el precio (el admin puede haberlo cambiado)
        await prisma.service.create({
          data: {
            applicationId: app.id,
            name: svcDef.name,
            price: svcDef.price,
            description: "",
          },
        });
      }
    }
    console.log(`   ✓ ${appDef.name}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.json({ message: "CRM API running" });
});

// ─────────────────────────────────────────────────────────────────────────────
// PÚBLICO — sin sesión  (/api/auth/login, /api/customer-auth/login)
// ─────────────────────────────────────────────────────────────────────────────

const publicRouter = express.Router();

publicRouter.post("/auth/login", async (req, res) => {
  const { username, password } = requireCredentials(req.body);
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    throw new ApiError(401, "Credenciales inválidas");
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRATION_HOURS);

  await prisma.session.create({ data: { token, expiresAt } });
  res.cookie(
    ADMIN_COOKIE_NAME,
    token,
    cookieOptions(TOKEN_EXPIRATION_HOURS * 60 * 60 * 1000),
  );
  res.json({ authenticated: true });
});

publicRouter.post("/customer-auth/login", async (req, res) => {
  const { username, password } = requireCredentials(req.body);

  const user = await prisma.user.findUnique({ where: { username } });
  const extraCredential = user
    ? null
    : await prisma.extraCredential.findUnique({ where: { username } });
  const passwordHash = user?.password ?? extraCredential?.password;
  if (!passwordHash || !(await bcrypt.compare(password, passwordHash))) {
    throw new ApiError(401, "Credenciales inválidas");
  }

  const ownerId = user?.id ?? extraCredential!.userId;
  const customer =
    user ?? (await prisma.user.findUniqueOrThrow({ where: { id: ownerId } }));
  const token = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRATION_HOURS);
  await prisma.session.create({ data: { token, userId: ownerId, expiresAt } });

  const { password: _, ...customerWithoutPassword } = customer;
  res.cookie(
    CUSTOMER_COOKIE_NAME,
    token,
    cookieOptions(TOKEN_EXPIRATION_HOURS * 60 * 60 * 1000),
  );
  res.json({ authenticated: true, user: customerWithoutPassword });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — requiere sesión de administrador
// ─────────────────────────────────────────────────────────────────────────────

const adminRouter = express.Router();
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

// ── CUSTOMERS ──────────────────────────────────────────────────────────────

adminRouter.get("/customers", async (_req, res) => {
  const customers = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      extraUsers: { select: { id: true, username: true } },
      instances: { include: instanceWithDetails },
    },
  });
  res.json(customers);
});

adminRouter.get("/customers/:id", async (req, res) => {
  const customer = await prisma.user.findUniqueOrThrow({
    where: { id: req.params.id },
    include: {
      extraUsers: { select: { id: true, username: true } },
      instances: { include: instanceWithDetails },
    },
  });
  res.json(customer);
});

adminRouter.post("/customers", async (req, res) => {
  const {
    dni,
    username,
    password,
    name,
    email,
    company,
    domains,
    status,
    phone,
    address,
    extraUsers,
  } = req.body;
  const customer = await prisma.user.create({
    data: {
      dni,
      username,
      password: await bcrypt.hash(password, SALT_ROUNDS),
      name,
      email,
      company: company ?? "",
      domains: domains ?? [],
      status: status ?? "PENDING",
      phone: phone ?? "",
      address: address ?? "",
    },
  });
  const createdExtraUsers = await prisma.extraCredential.createManyAndReturn({
    data: (extraUsers ?? []).map(
      (extraUser: { username: string; password: string }) => ({
        userId: customer.id,
        username: extraUser.username,
        password: bcrypt.hashSync(extraUser.password, SALT_ROUNDS),
      }),
    ),
    select: { id: true, username: true },
  });
  res.status(201).json({ ...customer, extraUsers: createdExtraUsers });
});

adminRouter.put("/customers/:id", async (req, res) => {
  const {
    dni,
    username,
    password,
    name,
    email,
    company,
    domains,
    status,
    phone,
    address,
    extraUsers,
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
        ...(username !== undefined && { username }),
        ...(password !== undefined && {
          password: await bcrypt.hash(password, SALT_ROUNDS),
        }),
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(company !== undefined && { company: company ?? "" }),
        ...(domains !== undefined && { domains: domains ?? [] }),
        ...(status !== undefined && { status }),
        ...(phone !== undefined && { phone: phone ?? "" }),
        ...(address !== undefined && { address: address ?? "" }),
      },
    });

    if (Array.isArray(extraUsers)) {
      const existing = await tx.extraCredential.findMany({
        where: { userId: req.params.id },
      });
      const retainedIds = extraUsers
        .map((extraUser: { id?: string }) => extraUser.id)
        .filter((extraId: string | undefined): extraId is string =>
          Boolean(extraId),
        );

      await tx.extraCredential.deleteMany({
        where: { userId: req.params.id, id: { notIn: retainedIds } },
      });

      for (const extraUser of extraUsers as {
        id?: string;
        username: string;
        password?: string;
      }[]) {
        if (extraUser.id && existing.some((item) => item.id === extraUser.id)) {
          await tx.extraCredential.update({
            where: { id: extraUser.id },
            data: {
              username: extraUser.username,
              ...(extraUser.password && {
                password: await bcrypt.hash(extraUser.password, SALT_ROUNDS),
              }),
            },
          });
        } else {
          await tx.extraCredential.create({
            data: {
              userId: req.params.id,
              username: extraUser.username,
              password: await bcrypt.hash(
                extraUser.password ?? "",
                SALT_ROUNDS,
              ),
            },
          });
        }
      }
    }

    return updatedCustomer;
  });

  const savedExtraUsers = await prisma.extraCredential.findMany({
    where: { userId: customer.id },
    select: { id: true, username: true },
  });
  res.json({ ...customer, extraUsers: savedExtraUsers });
});

adminRouter.delete("/customers/:id", async (req, res) => {
  const deleted = await prisma.user.deleteMany({
    where: { id: req.params.id },
  });
  if (deleted.count === 0) throw new ApiError(404, "Cliente no encontrado");
  res.status(204).end();
});

// ── APPLICATIONS (solo lectura + precio de servicios) ───────────────────────

adminRouter.get("/applications", async (_req, res) => {
  const apps = await prisma.application.findMany({
    orderBy: { id: "asc" },
    include: { services: { orderBy: { id: "asc" } } },
  });
  res.json(apps);
});

adminRouter.put("/services/:id", async (req, res) => {
  const { price } = req.body;
  const service = await prisma.service.update({
    where: { id: Number(req.params.id) },
    data: { ...(price !== undefined && { price }) },
  });
  res.json(service);
});

// ── CUSTOMER INSTANCES ───────────────────────────────────────────────────────

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
  const services = await prisma.service.findMany({
    where: { applicationId: Number(applicationId) },
  });
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
    prisma.payment.create({
      data: { instanceId, paidAt, note: note ?? "" },
    }),
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

// ── INSTANCE SERVICES ────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// CLIENTE — requiere sesión de cliente (Customer Portal)
// ─────────────────────────────────────────────────────────────────────────────

const customerRouter = express.Router();
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
    omit: { password: true },
    include: { instances: { include: instanceWithDetails } },
  });
  res.json(customer);
});

// ── RESTAURANTE — MENÚS ──────────────────────────────────────────────────────

customerRouter.get("/instances/:instanceId/menus", async (req, res) => {
  await ensureInstanceAccess(Number(req.params.instanceId), req.userId);
  const menus = await prisma.menu.findMany({
    where: { instanceId: Number(req.params.instanceId) },
    orderBy: { createdAt: "desc" },
    include: { dishes: { orderBy: { id: "asc" } } },
  });
  res.json(menus);
});

customerRouter.post("/instances/:instanceId/menus", async (req, res) => {
  await ensureInstanceAccess(Number(req.params.instanceId), req.userId);
  const menu = await prisma.menu.create({
    data: { instanceId: Number(req.params.instanceId), name: req.body.name },
    include: { dishes: true },
  });
  res.status(201).json(menu);
});

customerRouter.put("/menus/:menuId", async (req, res) => {
  const existingMenu = await prisma.menu.findUnique({
    where: { id: Number(req.params.menuId) },
  });
  if (!existingMenu) throw new ApiError(404, "Menú no encontrado");
  await ensureInstanceAccess(existingMenu.instanceId, req.userId);

  const menu = await prisma.menu.update({
    where: { id: Number(req.params.menuId) },
    data: { ...(req.body.name !== undefined && { name: req.body.name }) },
    include: { dishes: true },
  });
  res.json(menu);
});

customerRouter.delete("/menus/:menuId", async (req, res) => {
  const menu = await prisma.menu.findUnique({
    where: { id: Number(req.params.menuId) },
  });
  if (!menu) throw new ApiError(404, "Menú no encontrado");
  await ensureInstanceAccess(menu.instanceId, req.userId);
  await prisma.menu.delete({ where: { id: Number(req.params.menuId) } });
  res.status(204).end();
});

// ── RESTAURANTE — PLATOS ─────────────────────────────────────────────────────

customerRouter.get("/menus/:menuId/dishes", async (req, res) => {
  const menu = await prisma.menu.findUnique({
    where: { id: Number(req.params.menuId) },
  });
  if (!menu) throw new ApiError(404, "Menú no encontrado");
  await ensureInstanceAccess(menu.instanceId, req.userId);
  const dishes = await prisma.dish.findMany({
    where: { menuId: Number(req.params.menuId) },
    orderBy: { id: "asc" },
  });
  res.json(dishes);
});

customerRouter.post("/menus/:menuId/dishes", async (req, res) => {
  const menu = await prisma.menu.findUnique({
    where: { id: Number(req.params.menuId) },
  });
  if (!menu) throw new ApiError(404, "Menú no encontrado");
  await ensureInstanceAccess(menu.instanceId, req.userId);

  const { name, description, price, category } = req.body;
  const dish = await prisma.dish.create({
    data: {
      menuId: Number(req.params.menuId),
      name,
      description: description ?? "",
      price: price ?? "",
      category: category ?? "",
    },
  });
  res.status(201).json(dish);
});

customerRouter.put("/dishes/:dishId", async (req, res) => {
  const dish = await prisma.dish.findUnique({
    where: { id: Number(req.params.dishId) },
  });
  if (!dish) throw new ApiError(404, "Plato no encontrado");
  const menu = await prisma.menu.findUnique({ where: { id: dish.menuId } });
  await ensureInstanceAccess(menu!.instanceId, req.userId);

  const { name, description, price, category } = req.body;
  const updated = await prisma.dish.update({
    where: { id: Number(req.params.dishId) },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(price !== undefined && { price }),
      ...(category !== undefined && { category }),
    },
  });
  res.json(updated);
});

customerRouter.delete("/dishes/:dishId", async (req, res) => {
  const dish = await prisma.dish.findUnique({
    where: { id: Number(req.params.dishId) },
  });
  if (!dish) throw new ApiError(404, "Plato no encontrado");
  const menu = await prisma.menu.findUnique({ where: { id: dish.menuId } });
  if (!menu) throw new ApiError(404, "Menú no encontrado");
  await ensureInstanceAccess(menu.instanceId, req.userId);
  await prisma.dish.delete({ where: { id: Number(req.params.dishId) } });
  res.status(204).end();
});

// ── RESTAURANTE — RESERVAS ───────────────────────────────────────────────────

// GET /api/instances/:instanceId/reservations — filtros opcionales ?date=YYYY-MM-DD  ?status=PENDING
customerRouter.get("/instances/:instanceId/reservations", async (req, res) => {
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
});

customerRouter.post("/instances/:instanceId/reservations", async (req, res) => {
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
});

customerRouter.put("/reservations/:reservationId", async (req, res) => {
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

customerRouter.delete("/reservations/:reservationId", async (req, res) => {
  const reservationId = Number(req.params.reservationId);
  const existing = await prisma.reservation.findUnique({
    where: { id: reservationId },
  });
  if (!existing) throw new ApiError(404, "Reserva no encontrada");
  await ensureInstanceAccess(existing.instanceId, req.userId);
  await prisma.reservation.delete({ where: { id: reservationId } });
  res.status(204).end();
});

// ─────────────────────────────────────────────────────────────────────────────
// Montaje de routers
// ─────────────────────────────────────────────────────────────────────────────

app.use("/api", publicRouter);
app.use("/api", adminRouter);
app.use("/api", customerRouter);

// ─────────────────────────────────────────────────────────────────────────────
// Error handler global
// ─────────────────────────────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof ApiError ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.message ?? "Internal server error" });
});

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

syncApplications()
  .then(() => {
    app.listen(port, () => {
      console.log(`🚀 CRM API running on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("❌ Error al inicializar:", err);
    process.exit(1);
  });
