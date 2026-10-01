/**
 * Generador de QR del menu: PNG suelto o PDF listo para imprimir y poner en las
 * mesas.
 *
 * Cada mesa recibe su propio token, asi el menu abre con la mesa identificada
 * (el pedido ya sabe de donde viene) y los escaneos quedan contados por mesa.
 */
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

import { env } from '../../env.js';
import { generateQrToken } from '../../lib/ids.js';
import { prisma } from '../../prisma.js';

export interface QrTarget {
  tableLabel: string | null;
  token: string;
  url: string;
}

/** Devuelve (creando si hace falta) un QR por cada mesa pedida. */
export async function ensureQrCodes(
  tenantId: string,
  slug: string,
  tables: string[],
): Promise<QrTarget[]> {
  // Sin mesas: un unico QR general del local.
  const labels: Array<string | null> = tables.length > 0 ? tables : [null];
  const targets: QrTarget[] = [];

  for (const label of labels) {
    let record = await prisma.qrCode.findFirst({
      where: { tenantId, tableLabel: label },
    });
    record ??= await prisma.qrCode.create({
      data: { tenantId, tableLabel: label, token: generateQrToken() },
    });

    const url = new URL(`/m/${slug}`, env.PUBLIC_WEB_URL);
    url.searchParams.set('t', record.token);
    if (label) url.searchParams.set('mesa', label);

    targets.push({
      tableLabel: record.tableLabel,
      token: record.token,
      url: url.toString(),
    });
  }

  return targets;
}

export async function renderQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    width: 900,
    margin: 1,
    // Correccion alta: el QR sigue leyendose con una mancha de salsa encima.
    errorCorrectionLevel: 'H',
  });
}

export interface QrPdfOptions {
  restaurantName: string;
  /** Tarjetas por pagina: 1, 2 o 4. */
  perPage: number;
  targets: QrTarget[];
  accentColor?: string;
}

/**
 * Arma el PDF de tarjetas. Devuelve el buffer completo porque un menu tiene
 * decenas de mesas como maximo; para volumenes mayores conviene devolver el
 * stream directamente al `reply`.
 */
export async function renderQrPdf(options: QrPdfOptions): Promise<Buffer> {
  const { restaurantName, targets } = options;
  const perPage = [1, 2, 4].includes(options.perPage) ? options.perPage : 4;
  const accent = options.accentColor ?? '#2a78d6';

  const doc = new PDFDocument({ size: 'A4', margin: 28 });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const pageHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
  const cols = perPage === 1 ? 1 : 2;
  const rows = perPage === 4 ? 2 : 1;
  const cellW = pageWidth / cols;
  const cellH = pageHeight / rows;

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i]!;
    const slot = i % perPage;
    if (i > 0 && slot === 0) doc.addPage();

    const col = slot % cols;
    const row = Math.floor(slot / cols);
    const x = doc.page.margins.left + col * cellW;
    const y = doc.page.margins.top + row * cellH;

    // Marco de corte.
    doc
      .roundedRect(x + 6, y + 6, cellW - 12, cellH - 12, 10)
      .lineWidth(0.8)
      .strokeColor('#d8d7d2')
      .stroke();

    const qrSize = Math.min(cellW - 90, cellH - 150);
    const qrBuffer = await QRCode.toBuffer(target.url, {
      type: 'png',
      width: 800,
      margin: 0,
      errorCorrectionLevel: 'H',
    });

    doc
      .fillColor('#0b0b0b')
      .font('Helvetica-Bold')
      .fontSize(perPage === 1 ? 24 : 16)
      .text(restaurantName, x + 24, y + 28, {
        width: cellW - 48,
        align: 'center',
      });

    doc
      .fillColor(accent)
      .font('Helvetica-Bold')
      .fontSize(perPage === 1 ? 14 : 11)
      .text('MENU EN 3D Y REALIDAD AUMENTADA', x + 24, doc.y + 4, {
        width: cellW - 48,
        align: 'center',
        characterSpacing: 1.2,
      });

    doc.image(qrBuffer, x + (cellW - qrSize) / 2, doc.y + 14, {
      width: qrSize,
      height: qrSize,
    });

    const textY = doc.y + qrSize + 24;
    doc
      .fillColor('#52514e')
      .font('Helvetica')
      .fontSize(perPage === 1 ? 13 : 10)
      .text(
        target.tableLabel
          ? `Mesa ${target.tableLabel} — escanea y mira el plato antes de pedirlo`
          : 'Escanea y mira el plato en 3D antes de pedirlo',
        x + 24,
        textY,
        { width: cellW - 48, align: 'center' },
      );
  }

  doc.end();
  return finished;
}

/** Cuenta el escaneo de un QR (lo llama la PWA al abrir el menu con `?t=`). */
export async function registerScan(token: string): Promise<void> {
  await prisma.qrCode.updateMany({
    where: { token },
    data: { scans: { increment: 1 }, lastScanAt: new Date() },
  });
}
