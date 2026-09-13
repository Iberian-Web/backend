export const ADMIN_COOKIE_NAME = "admin_session_token";
export const CUSTOMER_COOKIE_NAME = "customer_session_token";
export const TOKEN_EXPIRATION_HOURS = 24;
export const TOKEN_EXPIRATION_MS = TOKEN_EXPIRATION_HOURS * 60 * 60 * 1000;

const IS_PRODUCTION = process.env.NODE_ENV === "production";

// En producción el frontend vive en otro dominio (Cloudflare Pages): la
// petición es cross-site y la cookie necesita SameSite=None + Secure
// (Secure es obligatorio en cuanto SameSite es "none", exige HTTPS en el
// backend). En local (mismo origen vía proxy de Vite), "lax" + no-secure
// sigue funcionando.
type SameSite = "none" | "lax";

function baseCookieOptions() {
  return {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: (IS_PRODUCTION ? "none" : "lax") as SameSite,
  };
}

export function cookieOptions(maxAgeMs: number) {
  return { ...baseCookieOptions(), maxAge: maxAgeMs };
}

export function clearCookieOptions() {
  return baseCookieOptions();
}

export function expirationDate(hours = TOKEN_EXPIRATION_HOURS): Date {
  const date = new Date();
  date.setHours(date.getHours() + hours);
  return date;
}
