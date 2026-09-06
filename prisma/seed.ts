// pnpm --filter backend exec prisma migrate reset
// pnpm db:seed

import { PrismaClient, UserStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";
import "dotenv/config";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });
// ─── Random data helpers ──────────────────────────────────────────────────────

const firstNames = [
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
const lastNames = [
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
const domainsBase = [
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
const cities = [
  "Madrid",
  "Barcelona",
  "Valencia",
  "Sevilla",
  "Zaragoza",
  "Málaga",
  "Bilbao",
];
const streets = [
  "Calle Mayor",
  "Gran Vía",
  "Calle Alcala",
  "Paseo de la Castellana",
  "Avenida Diagonal",
  "Calle Larios",
];
const statuses = [
  UserStatus.ACTIVE,
  UserStatus.ACTIVE,
  UserStatus.ACTIVE,
  UserStatus.INACTIVE,
  UserStatus.PENDING,
];

// Helper para limpiar strings (quitar tildes y convertir a minúsculas)
function cleanString(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function randomItem<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateDNI() {
  const num = Math.floor(10000000 + Math.random() * 90000000);
  return `${num}${"TRWAGMYFPDXBNJZSQVHLCKE"[num % 23]}`;
}

async function seedReservations() {
  const reservasService = await prisma.service.findFirst({
    where: { name: "Reservas" },
  });
  if (!reservasService) return;

  const activeInstances = await prisma.instanceService.findMany({
    where: { serviceId: reservasService.id, active: true },
    select: { instanceId: true },
  });

  for (const { instanceId } of activeInstances) {
    const existing = await prisma.reservation.count({ where: { instanceId } });
    if (existing > 0) continue;

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const formatDate = (date: Date, hour: number, minute = 0) => {
      const formatted = new Date(date);
      formatted.setHours(hour, minute, 0, 0);
      return formatted;
    };

    await prisma.reservation.createMany({
      data: [
        {
          instanceId,
          customerName: "John Smith",
          customerPhone: "+34 666 111 222",
          customerEmail: "john@example.com",
          reservationDate: formatDate(today, 21),
          guests: 4,
          notes: "Outdoor seating preferred",
          status: "CONFIRMED",
        },
        {
          instanceId,
          customerName: "Ana Martínez",
          customerPhone: "+34 612 345 678",
          customerEmail: "ana@example.com",
          reservationDate: formatDate(today, 13, 30),
          guests: 2,
          notes: "Aniversario — mesa con vela",
          status: "CONFIRMED",
        },
        {
          instanceId,
          customerName: "Lucía Fernández",
          customerPhone: "+34 677 111 222",
          customerEmail: "lucia@example.com",
          reservationDate: formatDate(today, 14, 30),
          guests: 6,
          notes: "Un comensal con silla de ruedas",
          status: "PENDING",
        },
        {
          instanceId,
          customerName: "Carlos Ruiz",
          customerPhone: "+34 654 333 444",
          customerEmail: "carlos@example.com",
          reservationDate: formatDate(today, 20),
          guests: 3,
          notes: "",
          status: "PENDING",
        },
        {
          instanceId,
          customerName: "Patricia Gómez",
          customerPhone: "+34 622 444 111",
          customerEmail: "patricia@example.com",
          reservationDate: formatDate(tomorrow, 13),
          guests: 8,
          notes: "Comida de empresa — menú cerrado",
          status: "CONFIRMED",
        },
        {
          instanceId,
          customerName: "Miguel Ángel Torres",
          customerPhone: "+34 699 555 333",
          customerEmail: "miguel@example.com",
          reservationDate: formatDate(tomorrow, 21, 30),
          guests: 2,
          notes: "",
          status: "PENDING",
        },
        {
          instanceId,
          customerName: "Isabel Torres",
          customerPhone: "+34 611 555 666",
          customerEmail: "isabel@example.com",
          reservationDate: formatDate(yesterday, 21),
          guests: 2,
          notes: "",
          status: "COMPLETED",
        },
        {
          instanceId,
          customerName: "Roberto Sanz",
          customerPhone: "+34 699 888 777",
          customerEmail: "roberto@example.com",
          reservationDate: formatDate(yesterday, 21, 30),
          guests: 4,
          notes: "",
          status: "NO_SHOW",
        },
        {
          instanceId,
          customerName: "David Moreno",
          customerPhone: "+34 645 222 999",
          customerEmail: "david@example.com",
          reservationDate: formatDate(today, 20, 30),
          guests: 2,
          notes: "",
          status: "CANCELLED",
        },
      ],
    });

    console.log(`   Reservas de ejemplo creadas para instancia ${instanceId}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Iniciando seeder…");

  // Wipe user data only
  await prisma.dish.deleteMany();
  await prisma.menu.deleteMany();
  await prisma.instanceService.deleteMany();
  await prisma.instance.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();

  const apps = await prisma.application.findMany({
    include: { services: true },
  });
  if (apps.length === 0) {
    throw new Error("No hay aplicaciones en la base de datos.");
  }

  // 15 random customers
  console.log("👥 Creando 15 clientes…");

  for (let i = 0; i < 15; i++) {
    const name = randomItem(firstNames);
    const surname1 = randomItem(lastNames);
    const surname2 = randomItem(lastNames);
    const suffix = Math.floor(Math.random() * 1000);

    // Limpieza de caracteres para el usuario
    const cleanName = cleanString(name);
    const cleanSurname = cleanString(surname1);

    const username = `${cleanName}.${cleanSurname}${suffix}`;
    const email = `${username}@example.com`;
    const company = `${surname1} ${randomItem(domainsBase)}`;

    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        dni: generateDNI(),
        username: username,
        password: await bcrypt.hash("cliente123", 10),
        name: `${name} ${surname1} ${surname2}`,
        email,
        company,
        domains: [`www.${company.replace(/\s/g, "").toLowerCase()}.com`],
        phone: `+34 6${Math.floor(Math.random() * 90000000) + 10000000}`,
        address: `${randomItem(streets)} ${Math.floor(Math.random() * 150) + 1}, ${randomItem(cities)}`,
        status: randomItem(statuses),
      },
    });

    // Assign 1–2 random apps
    const selectedApps = [...apps]
      .sort(() => 0.5 - Math.random())
      .slice(0, Math.floor(Math.random() * 2) + 1);

    for (const app of selectedApps) {
      const contractDate = new Date();
      contractDate.setDate(
        contractDate.getDate() - Math.floor(Math.random() * 730),
      );

      const instance = await prisma.instance.create({
        data: { userId: user.id, applicationId: app.id, contractDate },
      });

      for (const service of app.services) {
        if (Math.random() > 0.3) {
          await prisma.instanceService.create({
            data: {
              instanceId: instance.id,
              serviceId: service.id,
              active: Math.random() > 0.1,
              priceOverride: "",
            },
          });
        }
      }

      if (app.name === "Restaurante") {
        await prisma.menu.create({
          data: {
            instanceId: instance.id,
            name: "Carta Principal",
            dishes: {
              create: [
                {
                  name: "Tortilla Española",
                  price: "8.50",
                  category: "ENTRANTE",
                },
                {
                  name: "Croquetas de Jamon",
                  price: "9.00",
                  category: "ENTRANTE",
                },
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
  }

  await seedReservations();

  console.log("✅ Seeder completado con éxito.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
