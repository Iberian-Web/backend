import {
  PROVIDER,
  createPdfDoc,
  drawDivider,
  frequencyLabel,
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
 * Ficha de alcance del proyecto web: documento descriptivo (no legal) con
 * más detalle que el Anexo I del contrato sobre qué incluye cada servicio.
 */
export async function renderWebScopePdf(
  customer: DocumentCustomer,
  apps: DocumentAppLine[],
  options: DocumentOptions = {},
): Promise<Buffer> {
  const date = options.date ?? new Date();
  const city = options.city?.trim() || PROVIDER.city;

  const { doc, done } = createPdfDoc("Ficha de Alcance Web - Iberian Web");

  writeHeader(doc, "FICHA DE ALCANCE DEL PROYECTO WEB", city, date);
  writeCustomerSummary(doc, customer);

  // ── Resumen ──
  writeSectionTitle(doc, "Resumen del proyecto");
  writeParagraph(
    doc,
    `Este documento describe, de forma detallada y a título informativo, el conjunto de funcionalidades, servicios y condiciones de mantenimiento incluidos en la plataforma web de ${customer.company || customer.name}. No sustituye al contrato de prestación de servicios, sino que sirve como referencia clara de "qué incluye" el proyecto.`,
  );
  doc.moveDown(0.8);

  // ── Qué incluye la web ──
  const activeApps = apps.filter((app) => app.services.length > 0);
  writeSectionTitle(doc, "Qué incluye tu web");

  if (activeApps.length === 0) {
    writeParagraph(
      doc,
      "El proyecto contempla el diseño, desarrollo y puesta en marcha de un sitio web corporativo/informativo a medida, junto con su alojamiento, dominio y mantenimiento continuo, sin módulos o aplicaciones adicionales del catálogo.",
    );
    doc.moveDown(0.8);
  } else {
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
      doc.moveDown(0.3);

      for (const svc of app.services) {
        doc
          .fillColor("#111827")
          .font("Helvetica-Bold")
          .fontSize(10)
          .text(`•  ${svc.name}`, { indent: 10, continued: false });
        if (svc.description?.trim()) {
          doc
            .fillColor("#4B5563")
            .font("Helvetica")
            .fontSize(9.5)
            .text(svc.description.trim(), {
              indent: 20,
              lineGap: 2,
              align: "justify",
            });
        }
        doc
          .fillColor("#6B7280")
          .font("Helvetica")
          .fontSize(9)
          .text(`Precio: ${money(svc.price)}`, { indent: 20 });
        doc.moveDown(0.4);
      }
      doc.moveDown(0.5);
    }
  }

  // ── Elementos incluidos por defecto ──
  writeSectionTitle(doc, "Elementos técnicos incluidos");
  const included = [
    "Diseño responsive: la web se adapta correctamente a móvil, tablet y escritorio.",
    "Certificado de seguridad (SSL/HTTPS) activo desde la publicación.",
    "Optimización de velocidad de carga y buenas prácticas de SEO on-page.",
    "Alojamiento (hosting) sobre la infraestructura de Iberian Web.",
    "Formulario de contacto y enlaces a redes sociales, cuando aplique.",
  ];
  for (const item of included) writeBullet(doc, item);
  doc.moveDown(0.8);

  // ── Mantenimiento incluido ──
  writeSectionTitle(doc, "Mantenimiento incluido");
  const maintenanceItems = [
    "Actualizaciones de seguridad, librerías y parches del entorno de forma periódica.",
    "Monitorización de disponibilidad e intervención ante incidencias.",
    "Cambios básicos sin coste: logotipo, datos de contacto, horarios y enlaces a redes, solicitados con 24h de antelación.",
  ];
  for (const item of maintenanceItems) writeBullet(doc, item);
  doc.moveDown(0.3);
  writeParagraph(
    doc,
    `Cuota de mantenimiento: ${money(options.maintenanceFee)}${options.maintenanceFee?.trim() ? " (+ IVA)" : ", según condiciones acordadas"}. Cualquier rediseño estructural, nueva sección o funcionalidad adicional se presupuesta de forma independiente.`,
  );
  doc.moveDown(0.8);

  // ── Dominios ──
  if (customer.domains.length > 0) {
    writeSectionTitle(doc, "Dominio(s) asociado(s)");
    writeParagraph(doc, customer.domains.join(", "));
    doc.moveDown(0.8);
  }

  if (options.setupFee?.trim()) {
    writeSectionTitle(doc, "Coste de desarrollo inicial");
    writeParagraph(doc, `${money(options.setupFee)} (+ IVA).`);
    doc.moveDown(0.8);
  }

  if (options.notes?.trim()) {
    writeSectionTitle(doc, "Notas adicionales");
    writeParagraph(doc, options.notes.trim());
    doc.moveDown(0.8);
  }

  drawDivider(doc, 0.5);
  doc
    .fillColor("#6B7280")
    .font("Helvetica-Oblique")
    .fontSize(9)
    .text(
      "Documento informativo/descriptivo sin valor contractual independiente. Prevalecen, en caso de discrepancia, las condiciones recogidas en el contrato de prestación de servicios firmado con Iberian Web.",
      { align: "justify" },
    );

  doc.end();
  return done;
}
