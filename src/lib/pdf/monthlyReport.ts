import { createPdfDoc, drawDivider, formatDateEs } from "./shared";

// Informe de actividad del restaurante para un mes natural concreto (no es
// un documento contractual de Iberian Web, de ahí que lleve el nombre del
// negocio en la cabecera en vez de la marca de la plataforma).

export type MonthlyReportData = {
  restaurantName: string;
  restaurantAddress?: string;
  periodLabel: string; // p. ej. "Septiembre 2026"
  generatedAt: Date;
  revenue: { total: number; averageOrderValue: number; today: number };
  ordersTotal: number;
  ordersByStatus: Record<string, number>;
  reservationsTotal: number;
  reservationsByStatus: Record<string, number>;
  /** Comensales totales del periodo (opcional: solo si el llamante lo calcula). */
  reservationsTotalGuests?: number;
  /** Tasa de no-shows del periodo, en tanto por uno (0.05 = 5%). */
  reservationsNoShowRate?: number;
  topDishes: { name: string; quantity: number; revenue: number }[];
  dailySeries: { date: string; orders: number; revenue: number }[];
};

const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: "Nuevos",
  IN_PROGRESS: "En cocina",
  READY: "Listos",
  DELIVERED: "Entregados",
  CANCELLED: "Cancelados",
};

const RESERVATION_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendientes",
  CONFIRMED: "Confirmadas",
  CANCELLED: "Canceladas",
  COMPLETED: "Completadas",
  NO_SHOW: "No presentados",
};

const COLORS = {
  ink: "#111827",
  body: "#374151",
  muted: "#6B7280",
  faint: "#9CA3AF",
  border: "#E5E7EB",
  panel: "#F3F4F6",
  boxBg: "#FAFAFA",
  zebra: "#FAFAFA",
  teal: "#0F766E",
  blue: "#1D4ED8",
  zinc: "#52525B",
};

const money = (n: number) =>
  `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Formatea "2026-09-05" como "5 sep" para que la tabla no se salga de ancho. */
function shortDayLabel(isoDate: string): string {
  const [, month, day] = isoDate.split("-").map(Number);
  const MONTHS = [
    "ene",
    "feb",
    "mar",
    "abr",
    "may",
    "jun",
    "jul",
    "ago",
    "sep",
    "oct",
    "nov",
    "dic",
  ];
  return `${day} ${MONTHS[month - 1]}`;
}

function contentWidthOf(doc: PDFKit.PDFDocument): number {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

/** Salta de página si lo que viene a continuación no cabe entera. */
function ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

type Col = { text: string; width: number; align?: "left" | "right" };

/** Fila de tabla sencilla por posición X absoluta (pdfkit no trae tablas). */
function writeRow(doc: PDFKit.PDFDocument, cols: Col[], leftOverride?: number) {
  const left = leftOverride ?? doc.page.margins.left;
  let x = left;
  const y = doc.y;
  for (const col of cols) {
    doc.text(col.text, x, y, {
      width: col.width,
      align: col.align ?? "left",
      lineBreak: false,
    });
    x += col.width;
  }
  // Resetea el cursor: si no, el siguiente texto sin posición explícita
  // hereda la x de la última columna (p. ej. una alineada a la derecha).
  doc.x = left;
  doc.moveDown(1.1);
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string) {
  doc.x = doc.page.margins.left;
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(12).text(title);
  doc.moveDown(0.4);
}

/** Cabecera sombreada de tabla: un rectángulo de fondo detrás de la fila de títulos. */
function tableHeader(doc: PDFKit.PDFDocument, cols: Col[], totalWidth: number) {
  const left = doc.page.margins.left;
  doc.rect(left, doc.y - 3, totalWidth, 17).fill(COLORS.panel);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(COLORS.muted);
  writeRow(doc, cols);
}

/** Caja con borde y franja de color a la izquierda para separar secciones
 *  como "Resumen" o "Pedidos por estado" sin usar barras ni gráficos. */
function drawBox(
  doc: PDFKit.PDFDocument,
  width: number,
  title: string,
  rows: Col[][],
  accent: string,
): void {
  const padTop = 16;
  const padBottom = 18;
  const titleH = 22; // separación entre el título y la primera fila de datos
  const rowH = 17;
  const height = padTop + titleH + rows.length * rowH + padBottom;

  ensureSpace(doc, height + 18);
  const x = doc.page.margins.left;
  const y = doc.y;

  // Esquinas cuadradas (sin radio), a juego con el resto de tablas del informe.
  doc.rect(x, y, width, height).fillAndStroke(COLORS.boxBg, COLORS.border);
  doc.rect(x, y, 4, height).fill(accent);

  doc
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(title, x + 18, y + padTop, { width: width - 34 });

  doc.y = y + padTop + titleH;
  doc.font("Helvetica").fontSize(10).fillColor(COLORS.body);
  for (const row of rows) {
    writeRow(doc, row, x + 18);
  }

  doc.x = doc.page.margins.left;
  doc.y = y + height + 18; // margen antes del siguiente bloque
}

/** Como `drawBox`, pero reparte una lista plana de textos en `cols`
 *  columnas por fila en vez de tener que emparejarlos a mano. */
function drawGridBox(
  doc: PDFKit.PDFDocument,
  width: number,
  title: string,
  items: string[],
  accent: string,
  cols: number,
): void {
  const colWidth = (width - 34) / cols;
  const rows: Col[][] = [];
  for (let i = 0; i < items.length; i += cols) {
    const row: Col[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({ text: items[i + c] ?? "", width: colWidth });
    }
    rows.push(row);
  }
  drawBox(doc, width, title, rows, accent);
}

export async function renderMonthlyAnalyticsPdf(
  data: MonthlyReportData,
): Promise<Buffer> {
  const { doc, done } = createPdfDoc(
    `Informe mensual - ${data.restaurantName}`,
  );
  const contentWidth = contentWidthOf(doc);
  const innerWidth = contentWidth - 34; // ancho útil dentro de una caja (padding 18 + margen 16)
  const innerColWidth = innerWidth / 2;

  // ── Cabecera ────────────────────────────────────────────────────────────
  doc
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .fontSize(19)
    .text(data.restaurantName, { align: "center" });
  if (data.restaurantAddress) {
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(9.5)
      .text(data.restaurantAddress, { align: "center" });
  }
  doc.moveDown(0.3);
  doc
    .fillColor(COLORS.teal)
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(`Informe de actividad · ${data.periodLabel}`, { align: "center" });
  doc
    .fillColor(COLORS.faint)
    .font("Helvetica")
    .fontSize(8)
    .text(`Generado el ${formatDateEs(data.generatedAt)}`, {
      align: "center",
    });
  doc.moveDown(1.4);

  // ── Resumen del periodo ──────────────────────────────────────────────────
  drawBox(
    doc,
    contentWidth,
    "Resumen del periodo",
    [
      [
        {
          text: `Ingresos del periodo: ${money(data.revenue.total)}`,
          width: innerColWidth,
        },
        {
          text: `Ticket medio: ${money(data.revenue.averageOrderValue)}`,
          width: innerColWidth,
        },
      ],
      [
        {
          text: `Facturado hoy: ${money(data.revenue.today)}`,
          width: innerColWidth,
        },
        { text: `Pedidos totales: ${data.ordersTotal}`, width: innerColWidth },
      ],
      [
        {
          text: `Reservas totales: ${data.reservationsTotal}`,
          width: innerColWidth,
        },
        {
          text:
            data.reservationsTotalGuests !== undefined
              ? `Comensales totales: ${data.reservationsTotalGuests}`
              : "",
          width: innerColWidth,
        },
      ],
    ],
    COLORS.zinc,
  );

  // ── Pedidos por estado ───────────────────────────────────────────────────
  const orderItems = Object.entries(ORDER_STATUS_LABEL).map(
    ([status, label]) => `${label}: ${data.ordersByStatus[status] ?? 0}`,
  );
  drawGridBox(
    doc,
    contentWidth,
    "Pedidos por estado",
    orderItems,
    COLORS.teal,
    3,
  );

  // ── Reservas por estado ──────────────────────────────────────────────────
  const resItems = Object.entries(RESERVATION_STATUS_LABEL).map(
    ([status, label]) => `${label}: ${data.reservationsByStatus[status] ?? 0}`,
  );
  if (data.reservationsNoShowRate !== undefined) {
    resItems.push(
      `Tasa de no-shows: ${Math.round(data.reservationsNoShowRate * 1000) / 10}%`,
    );
  }
  drawGridBox(
    doc,
    contentWidth,
    "Reservas por estado",
    resItems,
    COLORS.blue,
    3,
  );

  // ── Platos más pedidos ──────────────────────────────────────────────────
  if (data.topDishes.length > 0) {
    sectionTitle(doc, "Platos más pedidos");
    const qtyW = 50;
    const revW = 90;
    const nameW = contentWidth - qtyW - revW;
    tableHeader(
      doc,
      [
        { text: "Uds.", width: qtyW },
        { text: "Plato", width: nameW },
        { text: "Ingresos", width: revW, align: "right" },
      ],
      contentWidth,
    );
    doc.font("Helvetica").fontSize(10).fillColor(COLORS.body);
    data.topDishes.forEach((dish, i) => {
      if (i % 2 === 1) {
        doc
          .rect(doc.page.margins.left, doc.y - 3, contentWidth, 17)
          .fill(COLORS.zebra);
        doc.fillColor(COLORS.body);
      }
      writeRow(doc, [
        { text: String(dish.quantity), width: qtyW },
        { text: dish.name, width: nameW },
        { text: money(dish.revenue), width: revW, align: "right" },
      ]);
    });
    doc.moveDown(0.6);
  }

  // ── Ingresos por día ────────────────────────────────────────────────────
  // Poco espacio antes de la línea y más después, para que no le haga de techo al título.
  doc.moveDown(0.3);
  doc
    .lineWidth(1)
    .strokeColor(COLORS.border)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();
  doc.moveDown(1.5);
  sectionTitle(doc, "Ingresos por día");
  const dayW = 55;
  const ordersW = 65;
  const pctW = 75;
  const revenueW = contentWidth - dayW - ordersW - pctW;
  tableHeader(
    doc,
    [
      { text: "Día", width: dayW },
      { text: "Pedidos", width: ordersW },
      { text: "Ingresos", width: revenueW, align: "right" },
      { text: "% del mes", width: pctW, align: "right" },
    ],
    contentWidth,
  );
  doc.font("Helvetica").fontSize(9.5).fillColor(COLORS.body);
  const monthTotal = data.revenue.total;
  data.dailySeries.forEach((day, i) => {
    // Salto de página manual antes de que pdfkit corte una fila a la mitad.
    if (doc.y > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
    } else if (i % 2 === 1) {
      doc
        .rect(doc.page.margins.left, doc.y - 3, contentWidth, 17)
        .fill(COLORS.zebra);
      doc.fillColor(COLORS.body);
    }
    const pct = monthTotal > 0 ? (day.revenue / monthTotal) * 100 : 0;
    writeRow(doc, [
      { text: shortDayLabel(day.date), width: dayW },
      { text: String(day.orders), width: ordersW },
      { text: money(day.revenue), width: revenueW, align: "right" },
      {
        text: day.revenue > 0 ? `${pct.toFixed(1)}%` : "—",
        width: pctW,
        align: "right",
      },
    ]);
  });

  drawDivider(doc, 0.5);
  doc
    .fillColor(COLORS.faint)
    .font("Helvetica-Oblique")
    .fontSize(8)
    .text(
      "Informe generado automáticamente a partir de los pedidos y reservas registrados en el sistema. Los pedidos cancelados no computan en los ingresos.",
      { align: "justify" },
    );

  doc.end();
  return done;
}
