import crypto from "crypto";
import bcrypt from "bcrypt";
import { Router } from "express";
import { prisma } from "../lib/prisma";
import { ApiError } from "../lib/errors";
import {
  ADMIN_COOKIE_NAME,
  CUSTOMER_COOKIE_NAME,
  TOKEN_EXPIRATION_HOURS,
  cookieOptions,
  expirationDate,
} from "../lib/cookies";
import { requireCredentials } from "../middleware/session";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  throw new Error("ADMIN_USERNAME y ADMIN_PASSWORD son obligatorios");
}

export const publicRouter = Router();

publicRouter.post("/auth/login", async (req, res) => {
  const { username, password } = requireCredentials(req.body);
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    throw new ApiError(401, "Credenciales inválidas");
  }

  const token = crypto.randomUUID();
  await prisma.session.create({ data: { token, expiresAt: expirationDate() } });
  res.cookie(
    ADMIN_COOKIE_NAME,
    token,
    cookieOptions(TOKEN_EXPIRATION_HOURS * 60 * 60 * 1000),
  );
  res.json({ authenticated: true });
});

publicRouter.post("/customer-auth/login", async (req, res) => {
  const { username, password } = requireCredentials(req.body);

  const credential = await prisma.credential.findUnique({
    where: { username },
  });
  if (!credential || !(await bcrypt.compare(password, credential.password))) {
    throw new ApiError(401, "Credenciales inválidas");
  }

  const customer = await prisma.user.findUniqueOrThrow({
    where: { id: credential.userId },
  });
  const token = crypto.randomUUID();
  await prisma.session.create({
    data: {
      token,
      userId: credential.userId,
      credentialId: credential.id,
      expiresAt: expirationDate(),
    },
  });

  res.cookie(
    CUSTOMER_COOKIE_NAME,
    token,
    cookieOptions(TOKEN_EXPIRATION_HOURS * 60 * 60 * 1000),
  );
  res.json({ authenticated: true, user: customer });
});
