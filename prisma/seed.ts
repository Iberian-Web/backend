// pnpm --filter backend exec prisma migrate reset
// pnpm db:seed

import "dotenv/config";
import bcrypt from "bcrypt";
import { UserStatus } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

// ─── Datos base ─────────────────────────────────────────────────────────

const FIRST_NAMES = [
  "Carlos",
  "Maria",
  "Laura",
  "Antonio",
  "David",
  "Carmen",
  "Jose",
  "Ana",
  "Francisco",
  "Elena",
  "Javier",
  "Lucia",
  "Manuel",
  "Isabel",
  "Pedro",
];
const LAST_NAMES = [
  "Garcia",
  "Rodriguez",
  "Gonzalez",
  "Fernandez",
  "Lopez",
  "Martinez",
  "Sanchez",
  "Perez",
  "Gomez",
  "Martin",
  "Ruiz",
  "Hernandez",
  "Jimenez",
  "Diaz",
  "Alvarez",
];
const DOMAIN_SUFFIXES = [
  "tech",
  "consulting",
  "services",
  "shop",
  "digital",
  "solutions",
  "group",
  "studio",
  "online",
  "web",
];
const CITIES = [
  "Madrid",
  "Barcelona",
  "Valencia",
  "Sevilla",
  "Zaragoza",
  "Málaga",
  "Bilbao",
];
const STREETS = [
  "Calle Mayor",
  "Gran Vía",
  "Calle Alcala",
  "Paseo de la Castellana",
  "Avenida Diagonal",
  "Calle Larios",
];
const STATUSES = [
  UserStatus.ACTIVE,
  UserStatus.ACTIVE,
  UserStatus.ACTIVE,
  UserStatus.INACTIVE,
  UserStatus.PENDING,
];

const CUSTOMER_COUNT = 15;
const DEFAULT_PASSWORD = "cliente123";

// ─── Helpers ────────────────────────────────────────────────────────────

function randomItem<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Quita tildes y pasa a minúsculas (para generar usernames/dominios). */
function slugify(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function generateDNI(): string {
  const num = Math.floor(10000000 + Math.random() * 90000000);
  return `${num}${"TRWAGMYFPDXBNJZSQVHLCKE"[num % 23]}`;
}

// ─── Clientes ───────────────────────────────────────────────────────────

async function seedCustomer(
  apps: { id: number; name: string; services: { id: number }[] }[],
) {
  const firstName = randomItem(FIRST_NAMES);
  const surname1 = randomItem(LAST_NAMES);
  const surname2 = randomItem(LAST_NAMES);
  const suffix = Math.floor(Math.random() * 1000);

  const username = `${slugify(firstName)}.${slugify(surname1)}${suffix}`;
  const email = `${username}@example.com`;
  const company = `${surname1} ${randomItem(DOMAIN_SUFFIXES)}`;

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      dni: generateDNI(),
      name: `${firstName} ${surname1} ${surname2}`,
      email,
      company,
      domains: [`www.${company.replace(/\s/g, "").toLowerCase()}.com`],
      phone: `+34 6${Math.floor(Math.random() * 90000000) + 10000000}`,
      address: `${randomItem(STREETS)} ${Math.floor(Math.random() * 150) + 1}, ${randomItem(CITIES)}`,
      status: randomItem(STATUSES),
    },
  });

  await prisma.credential.upsert({
    where: { username },
    update: {},
    create: {
      userId: user.id,
      name: `${firstName} ${surname1}`,
      username,
      password: await bcrypt.hash(DEFAULT_PASSWORD, 10),
    },
  });

  // Contrata entre 1 y 2 apps al azar.
  const selectedApps = [...apps]
    .sort(() => 0.5 - Math.random())
    .slice(0, Math.floor(Math.random() * 2) + 1);

  for (const app of selectedApps) {
    await seedInstance(user.id, app);
  }
}

async function seedInstance(
  userId: string,
  app: { id: number; name: string; services: { id: number }[] },
) {
  const contractDate = new Date();
  contractDate.setDate(
    contractDate.getDate() - Math.floor(Math.random() * 730),
  );

  const instance = await prisma.instance.create({
    data: { userId, applicationId: app.id, contractDate },
  });

  for (const service of app.services) {
    if (Math.random() <= 0.3) continue; // ~30% de servicios no contratados
    await prisma.instanceService.create({
      data: {
        instanceId: instance.id,
        serviceId: service.id,
        active: Math.random() > 0.1,
        priceOverride: "",
      },
    });
  }

  if (app.name === "Restaurante") {
    await prisma.menu.create({
      data: {
        instanceId: instance.id,
        name: "Carta Principal",
        dishes: {
          create: [
            { name: "Tortilla Española", price: "8.50", category: "ENTRANTE" },
            { name: "Croquetas de Jamon", price: "9.00", category: "ENTRANTE" },
            {
              name: "Paella Valenciana",
              price: "14.50",
              category: "PRINCIPAL",
            },
          ],
        },
      },
    });
  }
}

// ─── Reservas de ejemplo ────────────────────────────────────────────────

async function seedReservations() {
  const reservasService = await prisma.service.findFirst({
    where: { name: "Reservas" },
  });
  if (!reservasService) return;

  const activeInstances = await prisma.instanceService.findMany({
    where: { serviceId: reservasService.id, active: true },
    select: { instanceId: true },
  });

  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const at = (date: Date, hour: number, minute = 0) => {
    const result = new Date(date);
    result.setHours(hour, minute, 0, 0);
    return result;
  };

  for (const { instanceId } of activeInstances) {
    const alreadySeeded = await prisma.reservation.count({
      where: { instanceId },
    });
    if (alreadySeeded > 0) continue;

    await prisma.reservation.createMany({
      data: [
        {
          instanceId,
          customerName: "John Smith",
          customerPhone: "+34 666 111 222",
          customerEmail: "john@example.com",
          reservationDate: at(today, 21),
          guests: 4,
          notes: "Outdoor seating preferred",
          status: "CONFIRMED",
        },
        {
          instanceId,
          customerName: "Ana Martínez",
          customerPhone: "+34 612 345 678",
          customerEmail: "ana@example.com",
          reservationDate: at(today, 13, 30),
          guests: 2,
          notes: "Aniversario — mesa con vela",
          status: "CONFIRMED",
        },
        {
          instanceId,
          customerName: "Lucía Fernández",
          customerPhone: "+34 677 111 222",
          customerEmail: "lucia@example.com",
          reservationDate: at(today, 14, 30),
          guests: 6,
          notes: "Un comensal con silla de ruedas",
          status: "PENDING",
        },
        {
          instanceId,
          customerName: "Carlos Ruiz",
          customerPhone: "+34 654 333 444",
          customerEmail: "carlos@example.com",
          reservationDate: at(today, 20),
          guests: 3,
          notes: "",
          status: "PENDING",
        },
        {
          instanceId,
          customerName: "Patricia Gómez",
          customerPhone: "+34 622 444 111",
          customerEmail: "patricia@example.com",
          reservationDate: at(tomorrow, 13),
          guests: 8,
          notes: "Comida de empresa — menú cerrado",
          status: "CONFIRMED",
        },
        {
          instanceId,
          customerName: "Miguel Ángel Torres",
          customerPhone: "+34 699 555 333",
          customerEmail: "miguel@example.com",
          reservationDate: at(tomorrow, 21, 30),
          guests: 2,
          notes: "",
          status: "PENDING",
        },
        {
          instanceId,
          customerName: "Isabel Torres",
          customerPhone: "+34 611 555 666",
          customerEmail: "isabel@example.com",
          reservationDate: at(yesterday, 21),
          guests: 2,
          notes: "",
          status: "COMPLETED",
        },
        {
          instanceId,
          customerName: "Roberto Sanz",
          customerPhone: "+34 699 888 777",
          customerEmail: "roberto@example.com",
          reservationDate: at(yesterday, 21, 30),
          guests: 4,
          notes: "",
          status: "NO_SHOW",
        },
        {
          instanceId,
          customerName: "David Moreno",
          customerPhone: "+34 645 222 999",
          customerEmail: "david@example.com",
          reservationDate: at(today, 20, 30),
          guests: 2,
          notes: "",
          status: "CANCELLED",
        },
      ],
    });
  }
}

// ─── Pedidos de ejemplo ─────────────────────────────────────────────────

// Pool de platos para generar pedidos históricos variados (usado solo para
// poblar el gráfico de ingresos de Analíticas con datos realistas).
const DISH_POOL = [
  { name: "Croquetas de jamón", price: 8.5 },
  { name: "Ensalada César", price: 11.0 },
  { name: "Solomillo a la brasa", price: 24.5 },
  { name: "Pasta al pesto", price: 14.0 },
  { name: "Tiramisú artesanal", price: 6.5 },
  { name: "Agua mineral", price: 2.0 },
  { name: "Paella Valenciana", price: 14.5 },
  { name: "Tortilla Española", price: 8.5 },
];
const WAITERS = ["María G.", "Carlos R.", "Laura M."];

function pickRandomOrderItems() {
  const count = Math.floor(Math.random() * 3) + 1;
  return [...DISH_POOL]
    .sort(() => 0.5 - Math.random())
    .slice(0, count)
    .map((dish) => ({
      dishName: dish.name,
      quantity: Math.floor(Math.random() * 2) + 1,
      unitPrice: dish.price,
    }));
}

/** Fecha aleatoria dentro del día `daysAgo` (0 = hoy), en horario de comidas/cenas. */
function randomPastOrderDate(daysAgo: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(
    13 + Math.floor(Math.random() * 9), // entre las 13:00 y las 22:00
    Math.floor(Math.random() * 60),
    0,
    0,
  );
  return date;
}

async function seedOrders() {
  const pedidosService = await prisma.service.findFirst({
    where: { name: "Pedidos" },
  });
  if (!pedidosService) return;

  const activeInstances = await prisma.instanceService.findMany({
    where: { serviceId: pedidosService.id, active: true },
    select: { instanceId: true },
  });

  for (const { instanceId } of activeInstances) {
    const alreadySeeded = await prisma.order.count({ where: { instanceId } });
    if (alreadySeeded > 0) continue;

    // Historial de los últimos 29 días (0-3 pedidos/día, todos entregados)
    // para que el gráfico de ingresos de Analíticas tenga datos reales en
    // vez de un único pico en "hoy".
    //
    // Nota: no se puede mezclar el escalar `instanceId` con una relación
    // anidada `tableSession: { create }` en el mismo `order.create()` —
    // Prisma exige entonces que TODAS las relaciones (incluida `instance`)
    // vayan en modo relación en vez de escalar, y falla con "Argument
    // `instance` is missing". Por eso la sesión se crea aparte y solo se
    // referencia por `tableSessionId` (escalar), igual que el resto de campos.
    for (let daysAgo = 29; daysAgo >= 1; daysAgo--) {
      const ordersThatDay = Math.floor(Math.random() * 4);
      for (let n = 0; n < ordersThatDay; n++) {
        const createdAt = randomPastOrderDate(daysAgo);
        const tableNumber = Math.floor(Math.random() * 14) + 1;
        // Cada pedido histórico abre su propia sesión de mesa ya cerrada
        // (no hay nada más que combinar en estos datos de ejemplo).
        const session = await prisma.tableSession.create({
          data: {
            instanceId,
            tableNumber,
            openedAt: createdAt,
            closedAt: createdAt,
          },
        });
        await prisma.order.create({
          data: {
            instanceId,
            tableSessionId: session.id,
            tableNumber,
            waiterName: randomItem(WAITERS),
            status: "DELIVERED",
            createdAt,
            items: { create: pickRandomOrderItems() },
          },
        });
      }
    }

    // Pedidos de "hoy" con distintos estados, para poblar el tablero de cocina.
    const table4Session = await prisma.tableSession.create({
      data: { instanceId, tableNumber: 4 },
    });
    await prisma.order.create({
      data: {
        instanceId,
        tableSessionId: table4Session.id,
        tableNumber: 4,
        waiterName: "María G.",
        status: "IN_PROGRESS",
        notes: "Sin gluten en las croquetas",
        items: {
          create: [
            { dishName: "Croquetas de jamón", quantity: 2, unitPrice: 8.5 },
            { dishName: "Solomillo a la brasa", quantity: 1, unitPrice: 24.5 },
            { dishName: "Agua mineral", quantity: 2, unitPrice: 2.0 },
          ],
        },
      },
    });

    // Mesa 7: dos pedidos de la misma sentada (comida ya lista + un
    // segundo pedido recién entrado en cocina) para ilustrar cómo se
    // combinan en una sola cuenta al cerrar la mesa.
    const table7Session = await prisma.tableSession.create({
      data: { instanceId, tableNumber: 7 },
    });
    await prisma.order.create({
      data: {
        instanceId,
        tableNumber: 7,
        tableSessionId: table7Session.id,
        waiterName: "Carlos R.",
        status: "READY",
        items: {
          create: [
            { dishName: "Ensalada César", quantity: 2, unitPrice: 11.0 },
            { dishName: "Pasta al pesto", quantity: 1, unitPrice: 14.0 },
          ],
        },
      },
    });
    await prisma.order.create({
      data: {
        instanceId,
        tableNumber: 7,
        tableSessionId: table7Session.id,
        waiterName: "Carlos R.",
        status: "IN_PROGRESS",
        items: {
          create: [
            { dishName: "Tiramisú artesanal", quantity: 2, unitPrice: 6.5 },
          ],
        },
      },
    });

    const table2Session = await prisma.tableSession.create({
      data: { instanceId, tableNumber: 2 },
    });
    await prisma.order.create({
      data: {
        instanceId,
        tableSessionId: table2Session.id,
        tableNumber: 2,
        waiterName: "Laura M.",
        status: "READY",
        items: {
          create: [
            { dishName: "Solomillo a la brasa", quantity: 2, unitPrice: 24.5 },
            { dishName: "Tiramisú artesanal", quantity: 2, unitPrice: 6.5 },
          ],
        },
      },
    });

    const table11Session = await prisma.tableSession.create({
      data: { instanceId, tableNumber: 11, closedAt: new Date() },
    });
    await prisma.order.create({
      data: {
        instanceId,
        tableSessionId: table11Session.id,
        tableNumber: 11,
        waiterName: "María G.",
        status: "DELIVERED",
        items: {
          create: [
            { dishName: "Croquetas de jamón", quantity: 1, unitPrice: 8.5 },
            { dishName: "Agua mineral", quantity: 3, unitPrice: 2.0 },
          ],
        },
      },
    });

    const table9Session = await prisma.tableSession.create({
      data: { instanceId, tableNumber: 9, closedAt: new Date() },
    });
    await prisma.order.create({
      data: {
        instanceId,
        tableSessionId: table9Session.id,
        tableNumber: 9,
        waiterName: "Carlos R.",
        status: "CANCELLED",
        notes: "Cliente se marchó",
        items: {
          create: [
            { dishName: "Pasta al pesto", quantity: 2, unitPrice: 14.0 },
          ],
        },
      },
    });
  }
}

// ─── Mapa de mesas de ejemplo ───────────────────────────────────────────

// Coincide a propósito con los números de mesa usados en seedOrders() (2, 4,
// 7, 9 y 11) para que el mapa de demo muestre de entrada mesas en distintos
// estados (en cocina, listo para servir, libres) en vez de solo libres.
const DEMO_TABLES: {
  number: number;
  name?: string;
  seats: number;
  shape: "RECTANGLE" | "ROUND";
  posRow: number;
  posCol: number;
  width?: number;
  height?: number;
}[] = [
  { number: 1, seats: 2, shape: "RECTANGLE", posRow: 0, posCol: 0 },
  { number: 2, seats: 2, shape: "RECTANGLE", posRow: 0, posCol: 1 },
  { number: 3, seats: 4, shape: "RECTANGLE", posRow: 0, posCol: 2 },
  { number: 4, seats: 4, shape: "RECTANGLE", posRow: 0, posCol: 3 },
  { number: 5, seats: 2, shape: "ROUND", posRow: 2, posCol: 0 },
  { number: 6, seats: 2, shape: "ROUND", posRow: 2, posCol: 1 },
  {
    number: 7,
    name: "Mesa grande",
    seats: 6,
    shape: "RECTANGLE",
    posRow: 2,
    posCol: 2,
    width: 2,
  },
  { number: 8, seats: 4, shape: "RECTANGLE", posRow: 2, posCol: 4 },
  { number: 9, seats: 2, shape: "RECTANGLE", posRow: 4, posCol: 0 },
  { number: 10, seats: 4, shape: "ROUND", posRow: 4, posCol: 1 },
  { number: 11, seats: 2, shape: "RECTANGLE", posRow: 4, posCol: 2 },
  {
    number: 12,
    name: "Terraza",
    seats: 8,
    shape: "RECTANGLE",
    posRow: 4,
    posCol: 3,
    width: 2,
  },
];

async function seedTables() {
  const mapaService = await prisma.service.findFirst({
    where: { name: "Mapa" },
  });
  if (!mapaService) return;

  const activeInstances = await prisma.instanceService.findMany({
    where: { serviceId: mapaService.id, active: true },
    select: { instanceId: true },
  });

  for (const { instanceId } of activeInstances) {
    const alreadySeeded = await prisma.restaurantTable.count({
      where: { instanceId },
    });
    if (alreadySeeded > 0) continue;

    await prisma.restaurantTable.createMany({
      data: DEMO_TABLES.map((t) => ({ ...t, instanceId })),
    });
  }
}

// ─── Main ───────────────────────────────────────────────────────────────

async function resetUserData() {
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.tableSession.deleteMany();
  await prisma.restaurantTable.deleteMany();
  await prisma.dish.deleteMany();
  await prisma.menu.deleteMany();
  await prisma.instanceService.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  console.log("Iniciando seed...");

  await resetUserData();

  const apps = await prisma.application.findMany({
    include: { services: true },
  });
  if (apps.length === 0) {
    throw new Error("No hay aplicaciones en la base de datos.");
  }

  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    await seedCustomer(apps);
  }

  await seedReservations();
  await seedOrders();
  await seedTables();

  console.log("Seed completado.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
