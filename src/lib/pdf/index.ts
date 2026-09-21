import { renderContractPdf } from "./contract";
import { renderWebScopePdf } from "./webScope";
import { renderMaintenancePlanPdf } from "./maintenancePlan";
import { renderQuotePdf } from "./quote";
import { renderRenewalPdf } from "./renewal";
import type {
  DocumentAppLine,
  DocumentCustomer,
  DocumentOptions,
} from "./shared";

export type {
  DocumentAppLine,
  DocumentCustomer,
  DocumentServiceLine,
  DocumentOptions,
} from "./shared";

/** Tipos de documento soportados, en el mismo orden que el enum de Prisma. */
export const DOCUMENT_TYPES = [
  "CONTRACT",
  "WEB_SCOPE",
  "MAINTENANCE_PLAN",
  "QUOTE",
  "RENEWAL",
] as const;

export type SupportedDocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_META: Record<
  SupportedDocumentType,
  { label: string; filePrefix: string }
> = {
  CONTRACT: { label: "Contrato", filePrefix: "contrato" },
  WEB_SCOPE: { label: "Ficha de alcance web", filePrefix: "alcance-web" },
  MAINTENANCE_PLAN: {
    label: "Ficha de mantenimiento",
    filePrefix: "mantenimiento",
  },
  QUOTE: { label: "Presupuesto", filePrefix: "presupuesto" },
  RENEWAL: { label: "Renovación de contrato", filePrefix: "renovacion" },
};

/**
 * Paquete "Dar de alta": todos los documentos que se generan juntos al
 * registrar a un cliente nuevo. RENEWAL queda fuera a propósito — no existe
 * contrato previo que renovar en el momento del alta.
 */
export const ONBOARDING_BUNDLE: SupportedDocumentType[] = [
  "CONTRACT",
  "WEB_SCOPE",
  "MAINTENANCE_PLAN",
];

type Renderer = (
  customer: DocumentCustomer,
  apps: DocumentAppLine[],
  options: DocumentOptions,
) => Promise<Buffer>;

const RENDERERS: Record<SupportedDocumentType, Renderer> = {
  CONTRACT: renderContractPdf,
  WEB_SCOPE: renderWebScopePdf,
  MAINTENANCE_PLAN: renderMaintenancePlanPdf,
  QUOTE: renderQuotePdf,
  RENEWAL: renderRenewalPdf,
};

export function renderDocumentPdf(
  type: SupportedDocumentType,
  customer: DocumentCustomer,
  apps: DocumentAppLine[],
  options: DocumentOptions,
): Promise<Buffer> {
  return RENDERERS[type](customer, apps, options);
}

export function isSupportedDocumentType(
  value: string,
): value is SupportedDocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}
