import { Router } from "express";
import { prisma } from "../../lib/prisma";
import { ApiError } from "../../lib/errors";
import { ensureInstanceAccess } from "../../lib/access";
import { DEFAULT_MENU_SECTIONS } from "../../catalogue";

export const menusRouter = Router();

// ── MENÚS ──────────────────────────────────────────────────────────────

menusRouter.get("/instances/:instanceId/menus", async (req, res) => {
  await ensureInstanceAccess(Number(req.params.instanceId), req.userId);
  const menus = await prisma.menu.findMany({
    where: { instanceId: Number(req.params.instanceId) },
    orderBy: { createdAt: "desc" },
    include: { dishes: { orderBy: { id: "asc" } } },
  });
  res.json(menus);
});

menusRouter.post("/instances/:instanceId/menus", async (req, res) => {
  await ensureInstanceAccess(Number(req.params.instanceId), req.userId);
  const menu = await prisma.menu.create({
    data: { instanceId: Number(req.params.instanceId), name: req.body.name },
    include: { dishes: true },
  });
  res.status(201).json(menu);
});

menusRouter.put("/menus/:menuId", async (req, res) => {
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

menusRouter.delete("/menus/:menuId", async (req, res) => {
  const menu = await prisma.menu.findUnique({
    where: { id: Number(req.params.menuId) },
  });
  if (!menu) throw new ApiError(404, "Menú no encontrado");
  await ensureInstanceAccess(menu.instanceId, req.userId);
  await prisma.menu.delete({ where: { id: Number(req.params.menuId) } });
  res.status(204).end();
});

// ── SECCIONES DE CARTA ────────────────────────────────────────────────
// Lista propia por restaurante (Entrante, Principal, Postre...), gestionable:
// se puede crear, renombrar, reordenar y eliminar. Se siembra con el set por
// defecto al contratar la app (ver adminRouter.post("/customers/:id/instances")).

menusRouter.get("/instances/:instanceId/menu-sections", async (req, res) => {
  const instanceId = Number(req.params.instanceId);
  await ensureInstanceAccess(instanceId, req.userId);
  let sections = await prisma.menuSection.findMany({
    where: { instanceId },
    orderBy: { position: "asc" },
  });
  // Restaurantes creados antes de que existieran las secciones gestionables:
  // se siembran con el set por defecto la primera vez que se consultan.
  if (sections.length === 0) {
    await prisma.menuSection.createMany({
      data: DEFAULT_MENU_SECTIONS.map((name, position) => ({
        instanceId,
        name,
        position,
      })),
      skipDuplicates: true,
    });
    sections = await prisma.menuSection.findMany({
      where: { instanceId },
      orderBy: { position: "asc" },
    });
  }
  res.json(sections);
});

menusRouter.post("/instances/:instanceId/menu-sections", async (req, res) => {
  const instanceId = Number(req.params.instanceId);
  await ensureInstanceAccess(instanceId, req.userId);

  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  if (!name) throw new ApiError(400, "El nombre de la sección es requerido");

  const existing = await prisma.menuSection.findUnique({
    where: { instanceId_name: { instanceId, name } },
  });
  if (existing) throw new ApiError(409, "Ya existe una sección con ese nombre");

  const last = await prisma.menuSection.findFirst({
    where: { instanceId },
    orderBy: { position: "desc" },
  });
  const section = await prisma.menuSection.create({
    data: { instanceId, name, position: (last?.position ?? -1) + 1 },
  });
  res.status(201).json(section);
});

menusRouter.put("/menu-sections/:sectionId", async (req, res) => {
  const section = await prisma.menuSection.findUnique({
    where: { id: Number(req.params.sectionId) },
  });
  if (!section) throw new ApiError(404, "Sección no encontrada");
  await ensureInstanceAccess(section.instanceId, req.userId);

  const nextName =
    typeof req.body.name === "string" ? req.body.name.trim() : undefined;
  if (nextName !== undefined && !nextName) {
    throw new ApiError(400, "El nombre de la sección es requerido");
  }
  const nextPosition =
    typeof req.body.position === "number" ? req.body.position : undefined;

  if (nextName !== undefined && nextName !== section.name) {
    const clash = await prisma.menuSection.findUnique({
      where: {
        instanceId_name: { instanceId: section.instanceId, name: nextName },
      },
    });
    if (clash) throw new ApiError(409, "Ya existe una sección con ese nombre");
  }

  const [updated] = await prisma.$transaction([
    prisma.menuSection.update({
      where: { id: section.id },
      data: {
        ...(nextName !== undefined && { name: nextName }),
        ...(nextPosition !== undefined && { position: nextPosition }),
      },
    }),
    // Renombrar en cascada: todos los platos de este restaurante que usaban
    // el nombre anterior de la sección pasan a usar el nuevo, para que no
    // se queden "huérfanos" con una categoría que ya no existe.
    ...(nextName !== undefined && nextName !== section.name
      ? [
          prisma.dish.updateMany({
            where: {
              category: section.name,
              menu: { instanceId: section.instanceId },
            },
            data: { category: nextName },
          }),
        ]
      : []),
  ]);
  res.json(updated);
});

menusRouter.delete("/menu-sections/:sectionId", async (req, res) => {
  const section = await prisma.menuSection.findUnique({
    where: { id: Number(req.params.sectionId) },
  });
  if (!section) throw new ApiError(404, "Sección no encontrada");
  await ensureInstanceAccess(section.instanceId, req.userId);

  await prisma.$transaction([
    // Los platos que estaban en esta sección quedan sin sección en vez de
    // eliminarse: nunca se borra un plato por borrar una sección.
    prisma.dish.updateMany({
      where: {
        category: section.name,
        menu: { instanceId: section.instanceId },
      },
      data: { category: "" },
    }),
    prisma.menuSection.delete({ where: { id: section.id } }),
  ]);
  res.status(204).end();
});

// ── PLATOS ────────────────────────────────────────────────────────────

menusRouter.get("/menus/:menuId/dishes", async (req, res) => {
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

menusRouter.post("/menus/:menuId/dishes", async (req, res) => {
  const menu = await prisma.menu.findUnique({
    where: { id: Number(req.params.menuId) },
  });
  if (!menu) throw new ApiError(404, "Menú no encontrado");
  await ensureInstanceAccess(menu.instanceId, req.userId);

  const { name, description, price, category, allergens } = req.body;
  const dish = await prisma.dish.create({
    data: {
      menuId: Number(req.params.menuId),
      name,
      description: description ?? "",
      price: price ?? "",
      ...(category && { category }),
      allergens: allergens ?? [],
    },
  });
  res.status(201).json(dish);
});

menusRouter.put("/dishes/:dishId", async (req, res) => {
  const dish = await prisma.dish.findUnique({
    where: { id: Number(req.params.dishId) },
  });
  if (!dish) throw new ApiError(404, "Plato no encontrado");
  const menu = await prisma.menu.findUnique({ where: { id: dish.menuId } });
  await ensureInstanceAccess(menu!.instanceId, req.userId);

  const { name, description, price, category, allergens } = req.body;
  const updated = await prisma.dish.update({
    where: { id: Number(req.params.dishId) },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(price !== undefined && { price }),
      ...(category && { category }),
      ...(allergens !== undefined && { allergens }),
    },
  });
  res.json(updated);
});

menusRouter.delete("/dishes/:dishId", async (req, res) => {
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
