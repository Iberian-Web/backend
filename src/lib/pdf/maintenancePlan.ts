import {
  PROVIDER,
  createPdfDoc,
  drawDivider,
  money,
  writeBullet,
  writeCustomerSummary,
  writeHeader,
  writeParagraph,
  writeSectionTitle,
  type DocumentAppLine,
  type DocumentCustomer,
  type DocumentOptions,
} from "./shared";

/**
 * Ficha de mantenimiento y soporte técnico: detalla qué cubre y qué no
 * cubre la cuota recurrente, tiempos de respuesta y condiciones económicas.
 */
export async function renderMaintenancePlanPdf(
  customer: DocumentCustomer,
  apps: DocumentAppLine[],
  options: DocumentOptions = {},
): Promise<Buffer> {
  const date = options.date ?? new Date();
  const city = options.city?.trim() || PROVIDER.city;

  const { doc, done } = createPdfDoc("Ficha de Mantenimiento - Iberian Web");

  writeHeader(doc, "FICHA DE MANTENIMIENTO Y SOPORTE TÉCNICO", city, date);
  writeCustomerSummary(doc, customer);

  writeSectionTitle(doc, "Qué cubre el mantenimiento");
  const covered = [
    "Actualizaciones de seguridad, librerías y parches del entorno de forma periódica.",
    "Monitorización de disponibilidad y actuación ante caídas o incidencias del servicio.",
    "Copias de seguridad periódicas de la web y sus datos.",
    "Modificaciones básicas sin coste adicional: logotipo, teléfono, correo, dirección, horarios de atención y enlaces a redes sociales.",
    "Asistencia técnica en horario laboral estándar (lunes a viernes).",
  ];
  for (const item of covered) writeBullet(doc, item);
  doc.moveDown(0.8);

  writeSectionTitle(doc, "Qué no cubre (se presupuesta aparte)");
  const excluded = [
    "Rediseños estructurales o cambios de imagen de marca.",
    "Creación de nuevas secciones, páginas o funcionalidades no contempladas inicialmente.",
    "Integraciones con servicios de terceros no incluidos en el contrato original.",
    "Redacción o traducción de contenidos nuevos.",
  ];
  for (const item of excluded) writeBullet(doc, item);
  doc.moveDown(0.8);

  writeSectionTitle(doc, "Condiciones de solicitud");
  writeParagraph(
    doc,
    "Las solicitudes de modificaciones básicas incluidas deben enviarse por escrito (correo electrónico) con un margen mínimo de 24 horas de antelación, para poder organizar los trabajos adecuadamente.",
  );
  doc.moveDown(0.8);

  writeSectionTitle(doc, "Disponibilidad y tiempos de respuesta");
  writeParagraph(
    doc,
    "La infraestructura cuenta con sistemas de monitorización automática fuera del horario laboral. Ante una incidencia detectada, Iberian Web actúa con prioridad para restablecer el servicio a la mayor brevedad posible, si bien no es posible garantizar un funcionamiento ininterrumpido del 100% al depender de redes e infraestructuras de terceros.",
  );
  doc.moveDown(0.8);

  writeSectionTitle(doc, "Cuota y condiciones económicas");
  const apps2 = apps.filter((a) => a.services.length > 0);
  writeParagraph(
    doc,
    `Cuota de mantenimiento: ${money(options.maintenanceFee)}${options.maintenanceFee?.trim() ? " (+ IVA), facturada de forma recurrente según el ciclo indicado a continuación." : ", a definir en el Anexo I del contrato."}`,
  );
  doc.moveDown(0.3);
  for (const app of apps2) {
    writeBullet(
      doc,
      `${app.appName}: facturación ${app.billingFrequency === "ANNUAL" ? "anual" : "mensual"}, día ${app.billingDay} del ciclo.`,
    );
  }
  doc.moveDown(0.3);
  writeParagraph(
    doc,
    "Transcurridos 7 días naturales desde el vencimiento de una factura sin abonar, Iberian Web podrá suspender temporalmente el acceso a la web hasta la regularización del pago. Las tarifas podrán actualizarse notificándolo con un mínimo de 30 días de antelación.",
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
      "Documento informativo del servicio de mantenimiento recurrente. Prevalecen, en caso de discrepancia, las condiciones recogidas en el contrato de prestación de servicios firmado con Iberian Web.",
      { align: "justify" },
    );

  doc.end();
  return done;
}
