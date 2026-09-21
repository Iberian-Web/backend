import {
  PROVIDER,
  buildServicesAnnex,
  createPdfDoc,
  drawDivider,
  formatDateEs,
  money,
  writeDigitalAcceptance,
  type DocumentAppLine,
  type DocumentCustomer,
  type DocumentOptions,
} from "./shared";

// ─── Generador Principal del PDF ─────────────────────────────────────────
export async function renderContractPdf(
  customer: DocumentCustomer,
  apps: DocumentAppLine[],
  options: DocumentOptions = {},
): Promise<Buffer> {
  const date = options.date ?? new Date();
  const city = options.city?.trim() || PROVIDER.city;

  const { doc, done } = createPdfDoc("Contrato de Servicios - Iberian Web");

  // ── Título y Cabecera ──
  doc
    .fillColor("#111827")
    .font("Helvetica-Bold")
    .fontSize(16)
    .text("CONTRATO DE SERVICIOS DIGITALES, LICENCIA Y MANTENIMIENTO WEB", {
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
      ` (${PROVIDER.website}), con domicilio en ${PROVIDER.address}, NIF/CIF ${PROVIDER.nif}, correo de contacto ${PROVIDER.email}, representada por ${PROVIDER.representative} (en adelante, IBERIAN WEB).`,
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
      `, con domicilio en ${customer.address || "[dirección no indicada]"}, NIF/NIE ${customer.dni}, correo de contacto ${customer.email} (en adelante, EL CLIENTE).`,
    );

  doc.moveDown(1);
  doc
    .font("Helvetica-Oblique")
    .fillColor("#4B5563")
    .text(
      "Ambas partes expresan su voluntad de colaborar en un marco de confianza profesional y acuerdan someterse a las siguientes:",
      { align: "justify" },
    );
  doc.moveDown(1);

  // ── Cláusulas ──
  const clauses: { title: string; body: string[] }[] = [
    {
      title: "1. Objeto de la Colaboración",
      body: [
        "El objeto de este contrato es el diseño, desarrollo e implementación de la plataforma web de EL CLIENTE, así como la prestación del servicio continuo de alojamiento, mantenimiento técnico preventivo y soporte para garantizar su correcto funcionamiento.",
      ],
    },
    {
      title: "2. Modelo de Servicio y Propiedad de la Plataforma",
      body: [
        "• Propiedad de la Infraestructura: La estructura técnica, código base, arquitectura de servidor y herramientas desarrolladas para el correcto funcionamiento de la web pertenecen a IBERIAN WEB. El pago realizado por EL CLIENTE remunera el trabajo de desarrollo, adaptación y puesta en marcha del proyecto.",
        "• Licencia de Uso: Se concede a EL CLIENTE una licencia de uso exclusiva para su actividad comercial, de carácter personal e intransferible mientras el contrato se mantenga activo.",
        "• Intransitabilidad: Dado que la web se ejecuta sobre la infraestructura propia de IBERIAN WEB, la plataforma no es descargable ni migrable a servidores externos.",
      ],
    },
    {
      title: "3. Titularidad del Dominio",
      body: [
        "El dominio web registrado para el proyecto es y será en todo momento propiedad de EL CLIENTE. Durante la vigencia del presente contrato, EL CLIENTE autoriza a IBERIAN WEB a gestionar los registros DNS y la vinculación con el servidor. En caso de resolución del contrato, el dominio permanecerá en propiedad de EL CLIENTE, desvinculándose de los servidores de IBERIAN WEB.",
      ],
    },
    {
      title: "4. Propiedad del Material Aportado",
      body: [
        "EL CLIENTE garantiza que posee los derechos de propiedad intelectual, marcas, licencias y autorizaciones necesarias sobre todos los textos, marcas, logotipos, imágenes y contenidos que facilite a IBERIAN WEB para su publicación. EL CLIENTE mantendrá indemne a IBERIAN WEB ante cualquier reclamación de terceros derivada del uso de dicho material.",
      ],
    },
    {
      title: "5. Uso del Logo e Imagen Corporativa en Portafolio",
      body: [
        `EL CLIENTE autoriza expresamente a IBERIAN WEB a utilizar su nombre comercial, logotipo y un enlace hacia la web desarrollada dentro del apartado de casos de éxito, portafolio o materiales promocionales de ${PROVIDER.website}, con la única finalidad de mostrar el trabajo realizado.`,
      ],
    },
    {
      title: "6. Mantenimiento Técnico y Pequeñas Modificaciones Incluidas",
      body: [
        "El servicio recurrente incluye la tranquilidad de contar con una plataforma cuidada y actualizada:",
        "• Mantenimiento Preventivo: IBERIAN WEB se encarga de aplicar de forma periódica las actualizaciones de seguridad, librerías, parches del entorno y optimizaciones de servidor necesarias para mantener la web protegida y estable.",
        "• Modificaciones Básicas Incluidas: EL CLIENTE podrá solicitar ajustes menores sin coste adicional, tales como: sustitución o actualización del logotipo corporativo, modificación de datos básicos de contacto (número de teléfono, correo electrónico, dirección física o portal web), y actualización de horarios de atención al público o enlaces a redes sociales.",
        "• Condiciones de Solicitud: Para organizar adecuadamente los trabajos, estas solicitudes deberán enviarse por escrito con un margen mínimo de 24 horas de antelación.",
        "• Exclusiones: Cualquier rediseño estructural, creación de nuevas secciones, páginas adicionales o nuevas funcionalidades se presupuestará de forma independiente tras valorar el proyecto.",
      ],
    },
    {
      title: "7. Responsabilidad sobre Contenidos y Textos Legales",
      body: [
        "EL CLIENTE es el único responsable de la veracidad, legalidad y actualización de los contenidos, imágenes, precios y textos informativos publicados en la web. Asimismo, la revisión final y aprobación de los textos legales exigidos por la normativa de protección de datos (Aviso Legal, Política de Privacidad y Política de Cookies) corresponden a EL CLIENTE o a sus asesores legales.",
      ],
    },
    {
      title: "8. Garantía Inicial de Desarrollo",
      body: [
        "IBERIAN WEB ofrece un periodo de garantía de 30 días naturales a contar desde la fecha de publicación de la web para la corrección sin coste adicional de cualquier error o fallo de funcionamiento relacionado estrictamente con el desarrollo inicial acordado.",
      ],
    },
    {
      title: "9. Disponibilidad del Servicio y Limitación de Responsabilidad",
      body: [
        "• Compromiso de Soporte: En IBERIAN WEB ponemos todo nuestro empeño y profesionalidad para que la web funcione con los mayores niveles de rendimiento. La asistencia directa de nuestro equipo se realizará dentro del horario laboral estándar (de lunes a viernes). Fuera de este horario, la infraestructura cuenta con sistemas de monitorización automática.",
        "• Disponibilidad y Contingencias: Dado que los servicios digitales dependen de redes de telecomunicaciones e infraestructuras globales de terceros, no es posible garantizar un funcionamiento ininterrumpido del 100%.",
        "• Exención de Responsabilidad: IBERIAN WEB no se hace responsable de eventuales pérdidas económicas, lucro cesante o daños indirectos que pudiera sufrir EL CLIENTE derivados de caídas temporales del servicio, ataques cibernéticos, intromisiones ilegítimas de terceros o fallos en las redes de distribución. No obstante, IBERIAN WEB actuará con la máxima diligencia para prestar asistencia prioritaria y restablecer el servicio a la mayor brevedad posible.",
      ],
    },
    {
      title: "10. Condiciones Económicas, Facturación, Impagos y Tarifas",
      body: [
        `• Desarrollo Inicial: ${money(options.setupFee)} (+ IVA), abonados un 50% al inicio y el 50% restante a la publicación.`,
        options.maintenanceFee?.trim()
          ? `• Cuota de Servicio y Mantenimiento: ${money(options.maintenanceFee)} (+ IVA), según la periodicidad de facturación indicada en el Anexo I.`
          : "• Cuota de Servicio y Mantenimiento: Detallada en el Anexo I (+ IVA).",
        "• Paralización del Proyecto: Si durante la fase de desarrollo inicial EL CLIENTE retrasa la entrega de material, textos o aprobaciones necesarias por un periodo ininterrumpido superior a 15 días naturales, el proyecto se considerará tácitamente aprobado y se procederá a la facturación del 50% restante.",
        "• Actualización de Tarifas: IBERIAN WEB se reserva el derecho de revisar y actualizar la cuota del servicio de mantenimiento en cualquier momento debido a incrementos en los costes de la infraestructura digital o ajustes del servicio, notificándolo a EL CLIENTE con un mínimo de 30 días de antelación.",
        "• Suspensión por Impago: Transcurridos 7 días naturales desde el vencimiento de una factura sin que el pago se haya efectuado, IBERIAN WEB estará facultada para suspender temporalmente el acceso a la web hasta la regularización del saldo pendiente, sin que esto constituya incumplimiento contractual ni genere derecho a indemnización para EL CLIENTE.",
        "• Comisiones por Devolución de Cobros: En caso de que un recibo o cuota mensual sea devuelto por causas imputables a EL CLIENTE, EL CLIENTE asumirá la totalidad de los gastos y comisiones bancarias generados.",
      ],
    },
    {
      title: "11. Duración y Finalización del Servicio",
      body: [
        "El contrato tendrá una duración detallada en el Anexo I. En caso de cancelación del servicio por cualquiera de las partes o por impago de las cuotas, se procederá a la baja inmediata de la cuenta y a la desactivación permanente de la web de los servidores de IBERIAN WEB. EL CLIENTE reconoce y acepta que la cancelación conlleva la pérdida definitiva del acceso a la plataforma, no prestándose servicios de migración, copia de seguridad ni exportación de contenidos o datos tras la rescisión del contrato.",
      ],
    },
    {
      title: "12. Comunicaciones Oficiales",
      body: [
        "Se consideran válidas, oficiales y vinculantes todas las notificaciones, solicitudes de modificación (con el margen de 24 horas acordado) o avisos de cambio de condiciones enviadas a las direcciones de correo electrónico de contacto indicadas en el encabezamiento de este contrato.",
      ],
    },
    {
      title: "13. Protección de Datos",
      body: [
        "Ambas partes garantizan la confidencialidad de la información gestionada. Si la plataforma gestiona datos personales de clientes finales, IBERIAN WEB actuará en calidad de Encargado del Tratamiento conforme al Reglamento General de Protección de Datos (RGPD). Tras la finalización del contrato por cualquier motivo, IBERIAN WEB procederá a la destrucción completa e irrecuperable de las bases de datos en un plazo máximo de 30 días, sin retener información de terceros.",
      ],
    },
    {
      title: "14. Cumplimiento Normativo y Facturación",
      body: [
        "EL CLIENTE declara conocer que la legislación española y europea exige que la facturación, los sistemas informáticos de gestión y la recolección de datos de usuarios cumplan con los estándares vigentes. IBERIAN WEB velará por mantener la infraestructura técnica adaptada a dichos estándares, recayendo en EL CLIENTE la responsabilidad fiscal de sus propias operaciones comerciales.",
      ],
    },
    {
      title: "15. Jurisdicción y Ley Aplicable",
      body: [
        `Este contrato se rige por la legislación española. Para cualquier divergencia en su interpretación, ambas partes se someten expresamente a los Juzgados y Tribunales de la ciudad de ${PROVIDER.city}, España.`,
      ],
    },
  ];

  for (const clause of clauses) {
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(10.5)
      .text(clause.title);
    doc.moveDown(0.3);

    doc.fillColor("#374151").font("Helvetica").fontSize(10);
    for (const paragraph of clause.body) {
      doc.text(paragraph, { align: "justify", lineGap: 2.5 });
      doc.moveDown(0.3);
    }
    doc.moveDown(0.4);
  }

  if (options.notes?.trim()) {
    doc
      .fillColor("#111827")
      .font("Helvetica-Bold")
      .fontSize(10.5)
      .text("16. Notas adicionales");
    doc.moveDown(0.3);
    doc
      .fillColor("#374151")
      .font("Helvetica")
      .fontSize(10)
      .text(options.notes.trim(), { align: "justify", lineGap: 2.5 });
    doc.moveDown(1);
  }

  // ── Anexo de Servicios ──
  drawDivider(doc, 0.5);
  buildServicesAnnex(doc, apps, customer.domains);

  // ── Aceptación Digital ──
  writeDigitalAcceptance(doc);

  doc.end();
  return done;
}
