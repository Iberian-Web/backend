import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { ApiError } from "../lib/errors";
import { clearCookieOptions } from "../lib/cookies";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      // Solo se rellena en sesiones de customer portal iniciadas con una
      // Credential concreta (p. ej. un camarero/a) — ver requireSession().
      credentialId?: string;
    }
  }
}

export function requireSession(
  cookieName: string,
  opts: { customer: boolean },
) {
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
    if (session.credentialId) req.credentialId = session.credentialId;
    next();
  };
}

export function requireCredentials(body: unknown): {
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

/**
 * Resuelve el nombre de "camarero/a" a partir de la SESIÓN autenticada,
 * nunca de un valor enviado por el cliente (evita que se pueda falsificar).
 */
export async function resolveWaiterName(req: Request): Promise<string> {
  if (req.credentialId) {
    const credential = await prisma.credential.findUnique({
      where: { id: req.credentialId },
    });
    if (credential?.name?.trim()) return credential.name.trim();
  }
  const customer = await prisma.user.findUnique({ where: { id: req.userId! } });
  return customer?.name?.trim() || "Camarero/a";
}
