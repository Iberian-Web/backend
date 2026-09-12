import { prisma } from "./lib/prisma";

// Add new apps here and restart the server — syncApplications() handles the
// rest. Never add/remove from the UI; this is the single source of truth.
export const APP_CATALOGUE = [
  {
    name: "Restaurante",
    icon: "restaurant",
    color: "text-orange-400",
    services: [
      { name: "Menú Digital", price: "19.99" },
      { name: "Pedidos", price: "59.99" },
      { name: "Reservas", price: "49.99" },
      { name: "Cocina", price: "29.99" },
    ],
  },
] as const;

// Secciones de carta que se siembran por defecto en cualquier restaurante
// nuevo. A partir de ahí, cada restaurante puede crear, renombrar, reordenar
// o eliminar sus propias secciones libremente (ver rutas /menu-sections).
export const DEFAULT_MENU_SECTIONS = [
  "Entrante",
  "Principal",
  "Postre",
  "Bebida",
  "Guarnición",
  "Tapa",
  "Menú cerrado",
];

export async function syncApplications() {
  // Elimina del catálogo cualquier aplicación que ya no esté definida arriba
  // (esto también borra en cascada sus servicios, instancias contratadas, etc.)
  await prisma.application.deleteMany({
    where: { name: { notIn: APP_CATALOGUE.map((appDef) => appDef.name) } },
  });

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
  }
}
