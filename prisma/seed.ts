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

    await prisma.order.create({
      data: {
        instanceId,
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

    await prisma.order.create({
      data: {
        instanceId,
        tableNumber: 7,
        waiterName: "Carlos R.",
        status: "PENDING",
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

    await prisma.order.create({
      data: {
        instanceId,
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

    await prisma.order.create({
      data: {
        instanceId,
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

// ─── Main ───────────────────────────────────────────────────────────────

async function resetUserData() {
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
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

  console.log("Seed completado.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
