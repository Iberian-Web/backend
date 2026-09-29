import { ApiError } from "./errors";

/**
 * Control de concurrencia optimista compartido por mesas y pedidos: si el
 * cliente envía el `updatedAt` que tenía al cargar el recurso y ya no
 * coincide con el actual, otra persona lo modificó mientras tanto y se
 * rechaza en vez de dejar que gane silenciosamente quien escriba último.
 */
export function checkNotStale(
  expectedUpdatedAt: unknown,
  actualUpdatedAt: Date,
  staleMessage: string,
): void {
  if (expectedUpdatedAt === undefined) return;
  const expected = new Date(expectedUpdatedAt as string);
  if (Number.isNaN(expected.getTime())) {
    throw new ApiError(400, "expectedUpdatedAt inválido");
  }
  if (expected.getTime() !== actualUpdatedAt.getTime()) {
    throw new ApiError(409, staleMessage);
  }
}

/** Repite la comprobación dentro de la transacción para acotar al máximo la
 * ventana entre "leer" y "escribir" (mismo `baseline` ya validado fuera). */
export async function checkNotStaleInTx(
  fetchCurrent: () => Promise<{ updatedAt: Date } | null>,
  expectedUpdatedAt: unknown,
  baseline: Date,
  staleMessage: string,
): Promise<void> {
  if (expectedUpdatedAt === undefined) return;
  const current = await fetchCurrent();
  if (!current || current.updatedAt.getTime() !== baseline.getTime()) {
    throw new ApiError(409, staleMessage);
  }
}
