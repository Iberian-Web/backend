import {
  PROVIDER,
  buildServicesAnnex,
  createPdfDoc,
  drawDivider,
  formatDateEs,
  money,
  writeDigitalAcceptance,
  writeParagraph,
  writeSectionTitle,
  type DocumentAppLine,
  type DocumentCustomer,
  type DocumentOptions,
} from "./shared";

/**
 * Addendum de renovación: NO es un contrato nuevo, sino un documento que
 * prorroga el contrato original ya firmado (referenciado por su fecha) y
 * dejar constancia de qué condiciones económicas se actualizan, si alguna.
 * El resto de cláusulas del contrato original permanecen vigentes.
 *
 * `options.originalContractDate` es obligatorio en la práctica: la ruta que
 * llama a este renderer debe validar que existe un contrato previo antes de
 * generar una renovación (ver routes/documents.ts).
 */
export async function renderRenewalPdf(
  customer: DocumentCustomer,
  apps: DocumentAppLine[],
  options: DocumentOptions = {},
): Promise<Buffer> {
  const date = options.date ?? new Date();
  const city = options.city?.trim() || PROVIDER.city;

  const { doc, done } = createPdfDoc("Renovación de Contrato - Iberian Web");

  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(16)
    .text("ADDENDUM DE RENOVACIÓN DE CONTRATO DE SERVICIOS", {
      align: "center",
      lineGap: 4,
    });
  doc
    .fillColor("#6B7280")
    .font("Helvetica")
    .fontSize(10)
    .text(`En ${city}, a ${formatDateEs(date)}`, { align: "center" });
  drawDivider(doc, 1);

  // ── Partes Reunidas ──
  doc.fillColor("#111827").font("Helvetica-Bold").fontSize(12).text("REUNIDOS");
  doc.moveDown(0.5);
  doc.fillColor("#374151").font("Helvetica").fontSize(10);

  doc
    .text(`De una parte, `, { continued: true, align: "justify", lineGap: 3 })
    .font("Helvetica-Bold")
    .text(`${PROVIDER.name}`, { continued: true })
    .font("Helvetica")
    .text(
      ` (${PROVIDER.website}), con domicilio en ${PROVIDER.address}, NIF/CIF ${PROVIDER.nif}, representada por ${PROVIDER.representative} (en adelante, IBERIAN WEB).`,
    );

  doc.moveDown(0.5);
  doc
    .text(`De otra parte, `, { continued: true, align: "justify", lineGap: 3 })
    .font("Helvetica-Bold")
    .text(
      `${customer.name}${customer.company ? ` (${customer.company})` : ""}`,
      {
        continued: true,
      },
    )
    .font("Helvetica")
    .text(
      `, con domicilio en ${customer.address || "[dirección no indicada]"}, NIF/NIE ${customer.dni} (en adelante, EL CLIENTE).`,
    );
  doc.moveDown(1);

  // ── Antecedentes ──
  writeSectionTitle(doc, "1. Antecedentes");
  const originalDateText = options.originalContractDate
    ? formatDateEs(options.originalContractDate)
    : "[fecha del contrato original]";
  writeParagraph(
    doc,
    `Con fecha ${originalDateText}, las partes suscribieron un Contrato de Servicios Digitales, Licencia y Mantenimiento Web (en adelante, "el Contrato"), cuyo objeto es el diseño, desarrollo, alojamiento, licencia de uso y mantenimiento de la plataforma web de EL CLIENTE, junto con su Anexo I de servicios y condiciones económicas.`,
  );
  if (options.previousRenewalDate) {
    doc.moveDown(0.4);
    writeParagraph(
      doc,
      `El Contrato fue renovado con anterioridad mediante addendum de fecha ${formatDateEs(options.previousRenewalDate)}, cuyas condiciones quedan sustituidas por las recogidas en el presente documento.`,
    );
  }
  doc.moveDown(0.6);

  // ── Objeto de la renovación ──
  writeSectionTitle(doc, "2. Objeto de la renovación");
  writeParagraph(
    doc,
    "Mediante el presente addendum, ambas partes acuerdan renovar el Contrato por un nuevo periodo de servicio, manteniéndose en vigor la totalidad de sus cláusulas —incluidas las relativas a propiedad de la infraestructura, titularidad del dominio, garantías, disponibilidad, protección de datos y jurisdicción— salvo lo expresamente actualizado en la cláusula siguiente.",
  );
  doc.moveDown(0.6);

  // ── Condiciones económicas actualizadas ──
  writeSectionTitle(doc, "3. Condiciones económicas actualizadas");
  writeParagraph(
    doc,
    options.maintenanceFee?.trim()
      ? `• Cuota de Servicio y Mantenimiento: se actualiza a ${money(options.maintenanceFee)} (+ IVA) a partir de la presente renovación, sustituyendo a la cuota anteriormente vigente.`
      : "• Cuota de Servicio y Mantenimiento: se mantiene sin cambios, conforme a lo recogido en el Anexo I actualizado a continuación.",
  );
  if (options.setupFee?.trim()) {
    doc.moveDown(0.3);
    writeParagraph(
      doc,
      `• Coste adicional asociado a esta renovación (p.ej. ampliación de servicios): ${money(options.setupFee)} (+ IVA).`,
    );
  }
  doc.moveDown(0.3);
  writeParagraph(
    doc,
    "Cualquier actualización de tarifas por encima de lo aquí reflejado seguirá notificándose con un mínimo de 30 días de antelación, conforme a lo previsto en el Contrato original.",
  );
  doc.moveDown(0.6);

  if (options.notes?.trim()) {
    writeSectionTitle(doc, "4. Notas adicionales de la renovación");
    writeParagraph(doc, options.notes.trim());
    doc.moveDown(0.6);
  }

  writeSectionTitle(
    doc,
    `${options.notes?.trim() ? "5" : "4"}. Vigencia del resto de cláusulas`,
  );
  writeParagraph(
    doc,
    "Todas las cláusulas del Contrato original no modificadas expresamente por este addendum permanecen plenamente vigentes y de obligado cumplimiento para ambas partes, incluida su duración indefinida sujeta a la posibilidad de baja o impago prevista en el propio Contrato.",
  );

  // ── Anexo de Servicios actualizado ──
  drawDivider(doc, 0.5);
  buildServicesAnnex(
    doc,
    apps,
    customer.domains,
    "ANEXO I (ACTUALIZADO) — Servicios contratados y condiciones económicas",
  );

  // ── Aceptación Digital ──
  writeDigitalAcceptance(doc);

  doc.end();
  return done;
}
