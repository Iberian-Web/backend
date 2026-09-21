import type { UserStatus } from "@prisma/client";
import { ApiError } from "./errors";

type RawBody = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);

/** Campos "planos" del cliente, normalizados pero sin defaults — undefined = no lo mandó el cliente. */
function normalize(body: RawBody) {
  return {
    dni: str(body.dni),
    name: str(body.name),
    email: str(body.email),
    company: str(body.company),
    phone: str(body.phone),
    address: str(body.address),
    status:
      typeof body.status === "string" ? (body.status as UserStatus) : undefined,
    domains: Array.isArray(body.domains)
      ? body.domains.filter(
          (d): d is string => typeof d === "string" && d.trim().length > 0,
        )
      : undefined,
  };
}

/** Para crear: dni/name/email son obligatorios, el resto tiene default vacío. */
export function buildCreateData(body: RawBody) {
  const f = normalize(body);
  if (!f.dni || !f.name || !f.email) {
    throw new ApiError(400, "Nombre, email y DNI/NIF son obligatorios.");
  }
  return {
    dni: f.dni,
    name: f.name,
    email: f.email,
    company: f.company ?? "",
    domains: f.domains ?? [],
    status: f.status ?? "PENDING",
    phone: f.phone ?? "",
    address: f.address ?? "",
  };
}

/** Para actualizar: sólo se incluyen las claves que el cliente envió. */
export function buildUpdateData(body: RawBody) {
  const f = normalize(body);
  return {
    ...(f.dni !== undefined && { dni: f.dni }),
    ...(f.name !== undefined && { name: f.name }),
    ...(f.email !== undefined && { email: f.email }),
    ...(f.company !== undefined && { company: f.company }),
    ...(f.domains !== undefined && { domains: f.domains }),
    ...(f.status !== undefined && { status: f.status }),
    ...(f.phone !== undefined && { phone: f.phone }),
    ...(f.address !== undefined && { address: f.address }),
  };
}
