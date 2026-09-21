import {
  PROVIDER,
  createPdfDoc,
  drawDivider,
  frequencyLabel,
  money,
  writeCustomerSummary,
  writeHeader,
  writeParagraph,
  writeSectionTitle,
  type DocumentAppLine,
  type DocumentCustomer,
  type DocumentOptions,
} from "./shared";

/** Convierte un precio en texto (p.ej. "50", "50,00", "") a número, o null si no es numérico. */
function parseAmount(value?: string): number | null {
  if (!value || !value.trim()) return null;
  const normalized = value.trim().replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function formatMoneyNumber(n: number): string {
  return `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/**
 * Presupuesto: desglose de precios de lo contratado (o a contratar), pensado
 * para enviarse antes de firmar el contrato definitivo.
 */
export async function renderQuotePdf(
  customer: DocumentCustomer,
  apps: DocumentAppLine[],
  options: DocumentOptions = {},
): Promise<Buffer> {
  const date = options.date ?? new Date();
  const city = options.city?.trim() || PROVIDER.city;

  const { doc, done } = createPdfDoc("Presupuesto - Iberian Web");

  writeHeader(doc, "PRESUPUESTO", city, date);
  writeCustomerSummary(doc, customer);

  writeSectionTitle(doc, "Desglose");

  let recurringTotal = 0;
  let recurringHasUnknown = false;
  let oneOffTotal = 0;
  let oneOffHasUnknown = false;

  const setupAmount = parseAmount(options.setupFee);
  if (options.setupFee?.trim()) {
    doc
      .fillColor("#374151")
      .font("Helvetica")
      .fontSize(10)
      .text(`Desarrollo inicial (pago único)`, { continued: true })
      .font("Helvetica-Bold")
      .text(`  ${money(options.setupFee)}`, { align: "right" });
    if (setupAmount !== null) oneOffTotal += setupAmount;
    else oneOffHasUnknown = true;
    doc.moveDown(0.4);
  }

  const activeApps = apps.filter((a) => a.services.length > 0);
  if (activeApps.length === 0) {
    writeParagraph(
      doc,
      "Sin servicios recurrentes adicionales: presupuesto limitado al desarrollo de un sitio web corporativo/informativo y su mantenimiento base.",
    );
    doc.moveDown(0.4);
  } else {
    for (const app of activeApps) {
      doc
        .fillColor("#1F2937")
        .font("Helvetica-Bold")
        .fontSize(10.5)
        .text(`${app.appName} (${frequencyLabel(app.billingFrequency)})`);
      doc.moveDown(0.15);
      for (const svc of app.services) {
        doc
          .fillColor("#374151")
          .font("Helvetica")
          .fontSize(10)
          .text(`•  ${svc.name}`, { continued: true })
          .text(`  —  ${money(svc.price)}`, { align: "right" });
        const amount = parseAmount(svc.price);
        if (amount !== null) recurringTotal += amount;
        else recurringHasUnknown = true;
      }
      doc.moveDown(0.5);
    }
  }

  if (options.maintenanceFee?.trim()) {
    const maintenanceAmount = parseAmount(options.maintenanceFee);
    doc
      .fillColor("#374151")
      .font("Helvetica")
      .fontSize(10)
      .text(`Mantenimiento recurrente`, { continued: true })
      .font("Helvetica-Bold")
      .text(`  ${money(options.maintenanceFee)}`, { align: "right" });
    if (maintenanceAmount !== null) recurringTotal += maintenanceAmount;
    else recurringHasUnknown = true;
    doc.moveDown(0.4);
  }

  drawDivider(doc, 0.5);

  writeSectionTitle(doc, "Totales estimados (sin IVA)");
  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(10.5)
    .text(
      `Pago único: ${oneOffTotal > 0 || !oneOffHasUnknown ? formatMoneyNumber(oneOffTotal) : "a consultar"}${oneOffHasUnknown ? " (parcial, hay conceptos a consultar)" : ""}`,
    );
  doc.text(
    `Recurrente: ${recurringTotal > 0 || !recurringHasUnknown ? formatMoneyNumber(recurringTotal) : "a consultar"}${recurringHasUnknown ? " (parcial, hay conceptos a consultar)" : ""}`,
  );
  doc.moveDown(0.8);

  writeSectionTitle(doc, "Validez y condiciones");
  writeParagraph(
    doc,
    "Este presupuesto tiene una validez de 30 días naturales desde su fecha de emisión. Los precios indicados no incluyen IVA. La aceptación del presupuesto se formaliza mediante la firma del contrato de prestación de servicios correspondiente, momento en el que quedan fijadas las condiciones definitivas.",
  );

  if (options.notes?.trim()) {
    doc.moveDown(0.8);
    writeSectionTitle(doc, "Notas adicionales");
    writeParagraph(doc, options.notes.trim());
  }

  drawDivider(doc, 1);
  doc
    .fillColor("#6B7280")
    .font("Helvetica-Oblique")
    .fontSize(9)
    .text(
      "Documento orientativo sin valor contractual. Para aceptar este presupuesto, responde confirmando tu conformidad o procede a la firma del contrato correspondiente.",
      { align: "justify" },
    );

  doc.end();
  return done;
}
