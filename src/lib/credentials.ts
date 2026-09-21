import bcrypt from "bcrypt";
import { prisma } from "./prisma";
import { ApiError } from "./errors";

const SALT_ROUNDS = 10;

export type CredentialInput = {
  id?: string;
  name?: string;
  username?: string;
  password?: string;
  role?: string;
};

// Tipo del cliente dentro de una transacción, derivado del propio `prisma`
// en vez de `Prisma.TransactionClient` — evita depender del nombre exacto
// que expone la versión generada del cliente.
type Tx =
  typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const CREDENTIAL_SELECT = {
  id: true,
  name: true,
  username: true,
  role: true,
} as const;

/**
 * Valida y normaliza una credencial recibida del cliente. Lanza si falta el
 * usuario, o si es una credencial nueva sin contraseña — ésta es la única
 * fuente de verdad para esa regla, así que ninguna ruta puede saltársela
 * (incluso si el frontend un día deja de validarlo, esto sigue en pie).
 */
function sanitizeCredential(raw: CredentialInput, isNew: boolean) {
  const username = raw.username?.trim() ?? "";
  const name = raw.name?.trim() ?? "";
  const role = raw.role?.trim() ?? "";
  const password = raw.password?.trim() ?? "";

  if (!username) {
    throw new ApiError(
      400,
      `El usuario es obligatorio (credencial "${name || "sin nombre"}").`,
    );
  }
  if (isNew && !password) {
    throw new ApiError(
      400,
      `La credencial "${name || username}" es nueva y necesita una contraseña.`,
    );
  }

  return { id: raw.id, name, username, role, password: password || undefined };
}

/** Crea de golpe las credenciales de un cliente recién creado. */
export async function createCredentials(
  tx: Tx,
  userId: string,
  rawCredentials: CredentialInput[],
) {
  const sanitized = rawCredentials.map((c) => sanitizeCredential(c, true));
  const data = await Promise.all(
    sanitized.map(async (c) => ({
      userId,
      name: c.name,
      username: c.username,
      role: c.role,
      password: await bcrypt.hash(c.password!, SALT_ROUNDS),
    })),
  );
  return tx.credential.createManyAndReturn({ data, select: CREDENTIAL_SELECT });
}

/**
 * Reconcilia las credenciales de un cliente existente contra la lista
 * enviada: borra las que ya no están, actualiza las que siguen (sólo
 * re-hashea la contraseña si viene una nueva) y crea las que faltan.
 * Una credencial se considera "nueva" si no trae id o su id no existe ya
 * en BD — y toda credencial nueva exige contraseña (ver sanitizeCredential).
 */
export async function syncCredentials(
  tx: Tx,
  userId: string,
  rawCredentials: CredentialInput[],
) {
  const existing = await tx.credential.findMany({
    where: { userId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((c) => c.id));
  const keepIds = rawCredentials
    .map((c) => c.id)
    .filter((id): id is string => Boolean(id) && existingIds.has(id!));

  await tx.credential.deleteMany({
    where: { userId, id: { notIn: keepIds } },
  });

  for (const raw of rawCredentials) {
    const isNew = !raw.id || !existingIds.has(raw.id);
    const credential = sanitizeCredential(raw, isNew);

    if (isNew) {
      await tx.credential.create({
        data: {
          userId,
          name: credential.name,
          username: credential.username,
          role: credential.role,
          password: await bcrypt.hash(credential.password!, SALT_ROUNDS),
        },
      });
    } else {
      await tx.credential.update({
        where: { id: credential.id },
        data: {
          name: credential.name,
          username: credential.username,
          role: credential.role,
          ...(credential.password && {
            password: await bcrypt.hash(credential.password, SALT_ROUNDS),
          }),
        },
      });
    }
  }

  return tx.credential.findMany({
    where: { userId },
    select: CREDENTIAL_SELECT,
  });
}
