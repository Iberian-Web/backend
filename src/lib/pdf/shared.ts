import PDFDocument from "pdfkit";

// ─── Datos fijos del prestador (Iberian Web) ─────────────────────────────
export const PROVIDER = {
  name: process.env.COMPANY_NAME ?? "Iberian Web",
  website: process.env.COMPANY_WEBSITE ?? "iberianweb.com",
  email: process.env.COMPANY_EMAIL ?? "contacto@iberianweb.com",
  nif: process.env.COMPANY_NIF ?? "[NIF/CIF de Iberian Web]",
  address: process.env.COMPANY_ADDRESS ?? "[Dirección fiscal de Iberian Web]",
  representative:
    process.env.COMPANY_REPRESENTATIVE ?? "[Representante de Iberian Web]",
  city: process.env.COMPANY_CITY ?? "Madrid",
};

export type DocumentCustomer = {
  name: string;
  email: string;
  dni: string;
  company: string;
  address: string;
  domains: string[];
};

export type DocumentServiceLine = {
  name: string;
  description?: string;
  price: string;
};

export type DocumentAppLine = {
  appName: string;
  billingFrequency: "MONTHLY" | "ANNUAL";
  billingDay: number;
  services: DocumentServiceLine[];
};

export type DocumentOptions = {
  setupFee?: string;
  maintenanceFee?: string;
  notes?: string;
  city?: string;
  date?: Date;
  /** Fecha del contrato original — obligatoria para renderizar una RENEWAL. */
  originalContractDate?: Date;
  /** Fecha de la renovación inmediatamente anterior, si la hubiera. */
  previousRenewalDate?: Date;
};

// ─── Utilidades ──────────────────────────────────────────────────────────
export const money = (v?: string) =>
  v && v.trim() ? `${v.trim()} €` : "a consultar";
export const frequencyLabel = (f: "MONTHLY" | "ANNUAL") =>
  f === "ANNUAL" ? "anual" : "mensual";

export function formatDateEs(date: Date) {
  return date.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function drawDivider(doc: PDFKit.PDFDocument, yOffset: number = 0) {
  doc.moveDown(yOffset);
  doc.lineWidth(1).strokeColor("#E5E7EB");
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();
  doc.moveDown(yOffset > 0 ? yOffset : 1);
}

/** Crea el documento PDFKit y la promesa que resuelve con los bytes finales. */
export function createPdfDoc(title: string) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 56,
    info: { Title: title, Author: PROVIDER.name },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  return { doc, done };
}

/** Cabecera común (título + "En <ciudad>, a <fecha>" + separador). */
export function writeHeader(
  doc: PDFKit.PDFDocument,
  title: string,
  city: string,
  date: Date,
) {
  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(16)
    .text(title, { align: "center", lineGap: 4 });

  doc
    .fillColor("#6B7280")
    .font("Helvetica")
    .fontSize(10)
    .text(`En ${city}, a ${formatDateEs(date)}`, { align: "center" });

  drawDivider(doc, 1);
}

/** Bloque "Cliente" común a las fichas no contractuales (scope/mantenimiento/presupuesto). */
export function writeCustomerSummary(
  doc: PDFKit.PDFDocument,
  customer: DocumentCustomer,
) {
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(12).text("Cliente");
  doc.moveDown(0.4);
  doc.fillColor("#374151").font("Helvetica").fontSize(10);
  doc
    .font("Helvetica-Bold")
    .text(
      `${customer.name}${customer.company ? ` (${customer.company})` : ""}`,
    );
  doc
    .font("Helvetica")
    .fontSize(9.5)
    .fillColor("#6B7280")
    .text(
      `NIF/NIE ${customer.dni} · ${customer.email}${customer.address ? ` · ${customer.address}` : ""}`,
    );
  if (customer.domains.length > 0) {
    doc.text(`Dominio(s): ${customer.domains.join(", ")}`);
  }
  doc.moveDown(1);
}

/** Título de sección numerada, reutilizado por las fichas descriptivas. */
export function writeSectionTitle(doc: PDFKit.PDFDocument, title: string) {
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(12).text(title);
  doc.moveDown(0.4);
}

export function writeBullet(doc: PDFKit.PDFDocument, text: string) {
  doc
    .fillColor("#374151")
    .font("Helvetica")
    .fontSize(10)
    .text(`•  ${text}`, { indent: 10, lineGap: 2.5, align: "justify" });
}

export function writeParagraph(doc: PDFKit.PDFDocument, text: string) {
  doc
    .fillColor("#374151")
    .font("Helvetica")
    .fontSize(10)
    .text(text, { align: "justify", lineGap: 2.5 });
}

/**
 * Anexo I — servicios contratados y condiciones económicas. Compartido por
 * el contrato y la renovación, que reflejan el mismo estado de contratación
 * en el momento de su emisión.
 */
export function buildServicesAnnex(
  doc: PDFKit.PDFDocument,
  apps: DocumentAppLine[],
  domains: string[],
  title: string = "ANEXO I — Servicios contratados y condiciones económicas",
) {
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(13).text(title);
  doc.moveDown(0.5);

  const activeApps = apps.filter(
    (app) => app.services && app.services.length > 0,
  );

  if (activeApps.length === 0) {
    doc
      .fillColor("#4B5563")
      .font("Helvetica")
      .fontSize(10)
      .text(
        "El presente contrato ampara exclusivamente el diseño, desarrollo y mantenimiento de un sitio " +
          "web corporativo/informativo, sin servicios adicionales asociados a ningún catálogo de aplicaciones.",
        { lineGap: 3 },
      );
    if (domains && domains.length > 0) {
      doc.moveDown(0.5);
      doc
        .font("Helvetica-Bold")
        .text(`Dominio(s) asociado(s): `, { continued: true });
      doc.font("Helvetica").text(domains.join(", "));
    }
    doc.moveDown(2);
    return;
  }

  for (const app of activeApps) {
    doc
      .fillColor("#1F2937")
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(app.appName);
    doc
      .fillColor("#6B7280")
      .font("Helvetica")
      .fontSize(9.5)
      .text(
        `Facturación ${frequencyLabel(app.billingFrequency)}, día ${app.billingDay} del ciclo.`,
        { indent: 10, lineGap: 2 },
      );

    doc.moveDown(0.2);
    doc.fillColor("#374151").font("Helvetica").fontSize(10);

    for (const svc of app.services) {
      doc.text(`•  ${svc.name} — ${money(svc.price)}`, {
        indent: 10,
        lineGap: 2,
      });
    }
    doc.moveDown(0.8);
  }

  if (domains && domains.length > 0) {
    doc.moveDown(0.2);
    doc
      .fillColor("#374151")
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(`Dominio(s) asociado(s): `, { continued: true });
    doc.font("Helvetica").text(domains.join(", "));
    doc.moveDown();
  }
}

/**
 * Bloque de aceptación digital (LSSI) común al contrato y a la renovación:
 * ambos son documentos vinculantes que se aceptan sin firma manuscrita.
 */
export function writeDigitalAcceptance(doc: PDFKit.PDFDocument) {
  drawDivider(doc, 1);

  doc
    .fillColor("#1E3A8A")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text("ACEPTACIÓN DIGITAL Y VINCULACIÓN CONTRACTUAL", { align: "center" });
  doc.moveDown(0.8);

  doc.fillColor("#374151").font("Helvetica").fontSize(10);
  doc.text(
    "El presente documento es un contrato de prestación de servicios y licenciamiento de software. De conformidad con la Ley 34/2002, de 11 de julio, de servicios de la sociedad de la información y de comercio electrónico (LSSI), la aceptación expresa de este documento no requiere de firma manuscrita.",
    { align: "justify", lineGap: 3 },
  );
  doc.moveDown(0.5);
  doc.text(
    "La respuesta afirmativa por parte de EL CLIENTE mediante correo electrónico, o la marcación explícita de la casilla de aceptación en la plataforma digital facilitada por IBERIAN WEB, constituye la plena vinculación jurídica, el perfeccionamiento del contrato (o, en su caso, de su renovación) y la aceptación íntegra e incondicional de todas las cláusulas descritas en el presente documento.",
    { align: "justify", lineGap: 3 },
  );
}
