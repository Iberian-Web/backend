import { Router } from "express";
import { prisma } from "../lib/prisma";
import { ApiError } from "../lib/errors";
import { ADMIN_COOKIE_NAME } from "../lib/cookies";
import { requireSession } from "../middleware/session";
import {
  DOCUMENT_TYPE_META,
  ONBOARDING_BUNDLE,
  isSupportedDocumentType,
  renderDocumentPdf,
  type DocumentAppLine,
  type DocumentOptions,
  type SupportedDocumentType,
} from "../lib/pdf";

export const documentsRouter = Router();
documentsRouter.use(requireSession(ADMIN_COOKIE_NAME, { customer: false }));

const DOCUMENT_LIST_SELECT = {
  id: true,
  type: true,
  status: true,
  fileName: true,
  setupFee: true,
  maintenanceFee: true,
  notes: true,
  createdAt: true,
} as const;

/** Forma exacta del `include` usado para poder construir el Anexo I. */
type CustomerWithInstances = {
  id: string;
  name: string;
  email: string;
  dni: string;
  company: string;
  address: string;
  domains: string[];
  instances: {
    application: { name: string };
    billingFrequency: "MONTHLY" | "ANNUAL";
    billingDay: number;
    instanceServices: {
      active: boolean;
      priceOverride: string;
      service: { name: string; description: string; price: string };
    }[];
  }[];
};

const CUSTOMER_INCLUDE = {
  instances: {
    include: {
      application: true,
      instanceServices: { include: { service: true } },
    },
  },
} as const;

function buildAppLines(customer: CustomerWithInstances): DocumentAppLine[] {
  return customer.instances.map((inst) => ({
    appName: inst.application.name,
    billingFrequency: inst.billingFrequency,
    billingDay: inst.billingDay,
    services: inst.instanceServices
      .filter((is) => is.active)
      .map((is) => ({
        name: is.service.name,
        description: is.service.description,
        price: is.priceOverride || is.service.price,
      })),
  }));
}

/**
 * Una RENEWAL no puede generarse sin un CONTRACT previo: legalmente no hay
 * nada que prorrogar. Devuelve la fecha del contrato original (el primero
 * firmado) y, si existe, la de la renovación vigente más reciente.
 */
async function getRenewalReferenceDates(customerId: string) {
  const [originalContract, previousRenewal] = await Promise.all([
    prisma.document.findFirst({
      where: { userId: customerId, type: "CONTRACT" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.document.findFirst({
      where: { userId: customerId, type: "RENEWAL", status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  if (!originalContract) {
    throw new ApiError(
      400,
      "No hay ningún contrato previo para este cliente. Genera primero un contrato antes de crear una renovación.",
    );
  }

  return {
    originalContractDate: originalContract.createdAt,
    previousRenewalDate: previousRenewal?.createdAt,
  };
}

type DocumentInput = {
  setupFee?: string;
  maintenanceFee?: string;
  notes?: string;
  city?: string;
};

/** Tipo del cliente dentro de una transacción (mismo patrón que lib/credentials.ts). */
type Tx =
  typeof prisma | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Genera un PDF y lo guarda, marcando como SUPERSEDED el anterior del mismo tipo. */
async function generateAndStoreDocument(
  tx: Tx,
  customer: CustomerWithInstances,
  apps: DocumentAppLine[],
  type: SupportedDocumentType,
  input: DocumentInput,
  extraOptions: Partial<DocumentOptions> = {},
) {
  const pdf = await renderDocumentPdf(
    type,
    {
      name: customer.name,
      email: customer.email,
      dni: customer.dni,
      company: customer.company,
      address: customer.address,
      domains: customer.domains,
    },
    apps,
    { ...input, ...extraOptions },
  );

  const { filePrefix } = DOCUMENT_TYPE_META[type];
  const fileName = `${filePrefix}-${customer.dni || customer.id}-${Date.now()}-${type}.pdf`;

  await tx.document.updateMany({
    where: { userId: customer.id, type, status: "ACTIVE" },
    data: { status: "SUPERSEDED" },
  });
  return tx.document.create({
    data: {
      userId: customer.id,
      type,
      status: "ACTIVE",
      fileName,
      setupFee: input.setupFee?.trim() ?? "",
      maintenanceFee: input.maintenanceFee?.trim() ?? "",
      notes: input.notes?.trim() ?? "",
      data: pdf,
    },
    select: DOCUMENT_LIST_SELECT,
  });
}

// ── Generar un único documento (tipo a elección) ──────────────────────────
documentsRouter.post("/customers/:id/documents", async (req, res) => {
  const customer = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: CUSTOMER_INCLUDE,
  });
  if (!customer) throw new ApiError(404, "Cliente no encontrado");

  const {
    type: rawType,
    setupFee,
    maintenanceFee,
    notes,
    city,
  } = req.body as { type?: string } & DocumentInput;

  const type = rawType?.trim() || "CONTRACT";
  if (!isSupportedDocumentType(type)) {
    throw new ApiError(400, `Tipo de documento no soportado: "${type}"`);
  }

  const extraOptions: Partial<DocumentOptions> =
    type === "RENEWAL" ? await getRenewalReferenceDates(customer.id) : {};

  const apps = buildAppLines(customer);

  const document = await prisma.$transaction((tx) =>
    generateAndStoreDocument(
      tx,
      customer,
      apps,
      type,
      { setupFee, maintenanceFee, notes, city },
      extraOptions,
    ),
  );

  res.status(201).json(document);
});

// ── "Dar de alta": genera Contrato + Alcance web + Mantenimiento juntos ──
documentsRouter.post(
  "/customers/:id/documents/onboarding",
  async (req, res) => {
    const customer = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: CUSTOMER_INCLUDE,
    });
    if (!customer) throw new ApiError(404, "Cliente no encontrado");

    const { setupFee, maintenanceFee, notes, city } = req.body as DocumentInput;
    const apps = buildAppLines(customer);

    const documents = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const type of ONBOARDING_BUNDLE) {
        created.push(
          await generateAndStoreDocument(tx, customer, apps, type, {
            setupFee,
            maintenanceFee,
            notes,
            city,
          }),
        );
      }
      return created;
    });

    res.status(201).json(documents);
  },
);

// ── Listar documentos de un cliente (sin los bytes del PDF) ────────────────
documentsRouter.get("/customers/:id/documents", async (req, res) => {
  const documents = await prisma.document.findMany({
    where: { userId: req.params.id },
    select: DOCUMENT_LIST_SELECT,
    orderBy: { createdAt: "desc" },
  });
  res.json(documents);
});

// ── Descargar / previsualizar el PDF ────────────────────────────────────────
documentsRouter.get("/documents/:documentId/file", async (req, res) => {
  const document = await prisma.document.findUnique({
    where: { id: Number(req.params.documentId) },
  });
  if (!document) throw new ApiError(404, "Documento no encontrado");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${document.fileName}"`,
  );
  res.send(Buffer.from(document.data));
});

documentsRouter.delete("/documents/:documentId", async (req, res) => {
  const deleted = await prisma.document.deleteMany({
    where: { id: Number(req.params.documentId) },
  });
  if (deleted.count === 0) throw new ApiError(404, "Documento no encontrado");
  res.status(204).end();
});
