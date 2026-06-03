// apps/backend/src/services/wms/invoicePdf.service.ts
//
// WM-34 — Invoice PDF Generator
// --------------------------------
// Generates an A4 invoice PDF for a pack order.
//
// Layout:
//   [Sender info] ──────────── [Receiver info]
//   [Order #]                  [LSO barcode Code128]
//   ─────────────────────────────────────────────
//   [Line items: image | product name | qty | price]
//   ─────────────────────────────────────────────
//                              [Total]
//   [Terms & conditions footer]
//
// Print trigger: packer calls GET /api/v1/wms/orders/:orderId/invoice
// Reprint: same endpoint, idempotent.
//
// Images: fetched from variants.image_url. Fails gracefully — missing
// images render a grey placeholder box. Never fail the PDF.

import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from 'pdf-lib';
import bwipjs from 'bwip-js';

export interface InvoiceOrder {
  lasyncro_order_id: string;
  external_order_id: string;
  wms_barcode: string;
  total_price: number;
  currency: string;
  order_created_at: string;
  shipping_name: string | null;
  shipping_address1: string | null;
  shipping_address2: string | null;
  shipping_city: string | null;
  shipping_zip: string | null;
  shipping_province: string | null;
  shipping_country_code: string | null;
}

export interface InvoiceLineItem {
  title: string;
  product_title: string;
  variant_title: string;
  sku: string | null;
  quantity: number;
  unit_price: number | null;
  image_url: string | null;
}

export interface InvoiceShop {
  name: string;
  shop_domain: string;
  base_currency: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const A4_WIDTH  = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN    = 40;
const COL_WIDTH = A4_WIDTH - MARGIN * 2;

const BLACK  = rgb(0.05, 0.05, 0.05);
const GREY   = rgb(0.45, 0.45, 0.45);
const LIGHT  = rgb(0.92, 0.92, 0.92);
const WHITE  = rgb(1, 1, 1);

// ─── Barcode generation ───────────────────────────────────────────────────────

async function generateCode128Png(value: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer(
      {
        bcid: 'code128',
        text: value,
        scale: 2,
        height: 12,
        includetext: false,
        paddingwidth: 4,
        paddingheight: 2,
      },
      (err, png) => {
        if (err) reject(err);
        else resolve(png);
      }
    );
  });
}

// ─── Image fetch ──────────────────────────────────────────────────────────────

async function fetchImageBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = BLACK
) {
  page.drawText(String(text ?? ''), { x, y, size, font, color });
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
}

function formatCurrency(amount: number | null, currency: string): string {
  if (amount == null) return '—';
  return `${currency} ${Number(amount).toFixed(2)}`;
}

// ─── Main generator ───────────────────────────────────────────────────────────

export async function generateInvoicePdf(
  order: InvoiceOrder,
  lineItems: InvoiceLineItem[],
  shop: InvoiceShop
): Promise<Buffer> {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);

  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold    = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = A4_HEIGHT - MARGIN;

  // ── Header rule ──────────────────────────────────────────────────────────────
  page.drawRectangle({
    x: MARGIN,
    y: y - 2,
    width: COL_WIDTH,
    height: 2,
    color: BLACK,
  });
  y -= 18;

  // ── Sender info (left) ───────────────────────────────────────────────────────
  drawText(page, shop.name, MARGIN, y, fontBold, 11);
  drawText(page, shop.shop_domain, MARGIN, y - 14, fontRegular, 8, GREY);

  // ── Receiver info (right) ────────────────────────────────────────────────────
  const receiverX = MARGIN + COL_WIDTH / 2;
  const receiverName = order.shipping_name ?? 'No shipping address';
  drawText(page, receiverName, receiverX, y, fontBold, 11);

  const addrLines = [
    order.shipping_address1,
    order.shipping_address2,
    [order.shipping_city, order.shipping_zip].filter(Boolean).join(' '),
    [order.shipping_province, order.shipping_country_code].filter(Boolean).join(', '),
  ].filter(Boolean) as string[];

  let addrY = y - 14;
  for (const line of addrLines) {
    drawText(page, line, receiverX, addrY, fontRegular, 8, GREY);
    addrY -= 12;
  }

  y -= 50;

  // ── Order number (left) + LSO barcode (right) ────────────────────────────────
  const orderDate = order.order_created_at
    ? new Date(order.order_created_at).toLocaleDateString('en-GB')
    : '';
  drawText(page, `Order #${order.external_order_id}`, MARGIN, y, fontBold, 10);
  drawText(page, orderDate, MARGIN, y - 14, fontRegular, 8, GREY);

  // Barcode
  try {
    const barcodePng    = await generateCode128Png(order.wms_barcode);
    const barcodeImage  = await doc.embedPng(barcodePng);
    const barcodeWidth  = 160;
    const barcodeHeight = 40;
    const barcodeX      = A4_WIDTH - MARGIN - barcodeWidth;

    page.drawImage(barcodeImage, {
      x: barcodeX,
      y: y - barcodeHeight + 10,
      width: barcodeWidth,
      height: barcodeHeight,
    });
    drawText(
      page,
      order.wms_barcode,
      barcodeX + barcodeWidth / 2 - (order.wms_barcode.length * 3),
      y - barcodeHeight - 4,
      fontRegular,
      7,
      GREY
    );
  } catch (err) {
    console.error('[INVOICE_BARCODE_FAILED]', { wmsBarcode: order.wms_barcode, err });
    drawText(page, order.wms_barcode, A4_WIDTH - MARGIN - 120, y, fontBold, 10);
  }

  y -= 60;

  // ── Divider ──────────────────────────────────────────────────────────────────
  page.drawLine({
    start: { x: MARGIN, y },
    end:   { x: A4_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: LIGHT,
  });
  y -= 16;

  // ── Line items header ────────────────────────────────────────────────────────
  const COL_IMG   = MARGIN;
  const COL_NAME  = MARGIN + 44;
  const COL_SKU   = MARGIN + COL_WIDTH * 0.58;
  const COL_QTY   = MARGIN + COL_WIDTH * 0.72;
  const COL_PRICE = MARGIN + COL_WIDTH * 0.86;

  drawText(page, 'ITEM',   COL_NAME,  y, fontBold, 7, GREY);
  drawText(page, 'SKU',    COL_SKU,   y, fontBold, 7, GREY);
  drawText(page, 'QTY',    COL_QTY,   y, fontBold, 7, GREY);
  drawText(page, 'PRICE',  COL_PRICE, y, fontBold, 7, GREY);
  y -= 6;

  page.drawLine({
    start: { x: MARGIN, y },
    end:   { x: A4_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: LIGHT,
  });
  y -= 14;

  // ── Line items ───────────────────────────────────────────────────────────────
  for (const item of lineItems) {
    if (y < 160) break; // safety — avoid footer overlap

    const rowHeight = 40;

    // Image thumbnail
    if (item.image_url) {
      const imgBytes = await fetchImageBytes(item.image_url);
      if (imgBytes) {
        try {
          const isJpeg = item.image_url.includes('.jpg') || item.image_url.includes('.jpeg');
          const img    = isJpeg
            ? await doc.embedJpg(imgBytes)
            : await doc.embedPng(imgBytes);
          page.drawImage(img, { x: COL_IMG, y: y - rowHeight + 8, width: 34, height: 34 });
        } catch {
          // placeholder
          page.drawRectangle({ x: COL_IMG, y: y - rowHeight + 8, width: 34, height: 34, color: LIGHT });
        }
      } else {
        page.drawRectangle({ x: COL_IMG, y: y - rowHeight + 8, width: 34, height: 34, color: LIGHT });
      }
    } else {
      page.drawRectangle({ x: COL_IMG, y: y - rowHeight + 8, width: 34, height: 34, color: LIGHT });
    }

    // Product name
    const productLine = truncate(item.product_title || item.title, 40);
    const variantLine = item.variant_title && item.variant_title !== 'Default Title'
      ? truncate(item.variant_title, 40)
      : '';

    drawText(page, productLine, COL_NAME, y - 10, fontBold, 8);
    if (variantLine) {
      drawText(page, variantLine, COL_NAME, y - 22, fontRegular, 7, GREY);
    }

    // SKU
    drawText(page, item.sku ?? '—', COL_SKU, y - 10, fontRegular, 8, GREY);

    // Qty
    drawText(page, String(item.quantity), COL_QTY, y - 10, fontRegular, 8);

    // Unit price
    const unitTotal = item.unit_price != null
      ? formatCurrency(item.unit_price * item.quantity, shop.base_currency)
      : '—';
    drawText(page, unitTotal, COL_PRICE, y - 10, fontRegular, 8);

    y -= rowHeight + 4;

    // Row separator
    page.drawLine({
      start: { x: MARGIN, y },
      end:   { x: A4_WIDTH - MARGIN, y },
      thickness: 0.3,
      color: LIGHT,
    });
    y -= 6;
  }

  // ── Total ────────────────────────────────────────────────────────────────────
  y -= 10;
  page.drawLine({
    start: { x: MARGIN + COL_WIDTH * 0.6, y: y + 4 },
    end:   { x: A4_WIDTH - MARGIN, y: y + 4 },
    thickness: 0.5,
    color: BLACK,
  });
  drawText(page, 'TOTAL', COL_QTY, y - 8, fontBold, 9);
  drawText(
    page,
    formatCurrency(order.total_price, order.currency),
    COL_PRICE,
    y - 8,
    fontBold,
    9
  );

  // ── Footer ───────────────────────────────────────────────────────────────────
  const footerY = MARGIN + 20;
  page.drawLine({
    start: { x: MARGIN, y: footerY + 14 },
    end:   { x: A4_WIDTH - MARGIN, y: footerY + 14 },
    thickness: 0.5,
    color: LIGHT,
  });
  drawText(
    page,
    `Thank you for your order. For returns or queries, contact ${shop.shop_domain}`,
    MARGIN,
    footerY,
    fontRegular,
    7,
    GREY
  );

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
