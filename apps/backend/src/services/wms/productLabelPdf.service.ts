// apps/backend/src/services/wms/productLabelPdf.service.ts
//
// SHOP-REV-01g — Product Barcode Label PDF Generator
// ---------------------------------------------------
// Shopify review pause (2026-07-29, ref 102766) cited requirement 2.1.1:
// "the product barcodes are not generating." laSyncro could resolve a
// product barcode and print bin labels, unit labels and invoices, but had
// no path that produced a scannable label for a product. The Barcodes tab
// told the merchant to "Generate or import to clear" with no endpoint
// behind it.
//
// Renders the LSP- identity minted by productBarcode.service.ts. Never
// renders variants.barcode — that column is the Shopify-synced EAN/UPC
// (migration 0027) and belongs to the platform, not to us.
//
// Geometry and caption convention mirror unitLabelPdf.service.ts: same
// 4x2in thermal stock, same aspect-derived barcode height, same
// "sku · title" caption truncated at 36 chars.
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { generateCode128Png } from '../shared/barcodeGenerator.js';

export interface ProductLabelVariant {
  lasyncro_variant_id: string;
  lasyncro_barcode: string;
  sku: string | null;
  product_title: string | null;
  variant_title: string | null;
}

const LABEL_W = 288;
const LABEL_H = 144;
const BLACK = rgb(0, 0, 0);
const GREY  = rgb(0.4, 0.4, 0.4);

async function drawProductLabel(
  doc: PDFDocument,
  variant: ProductLabelVariant,
  fontBold: any,
  font: any
): Promise<void> {
  const page = doc.addPage([LABEL_W, LABEL_H]);

  const barcodePng = await generateCode128Png(variant.lasyncro_barcode);
  const barcodeImg = await doc.embedPng(barcodePng);
  const barcodeW   = LABEL_W - 40;
  const barcodeH   = barcodeImg.height * (barcodeW / barcodeImg.width);
  const barcodeY   = LABEL_H - barcodeH - 24;

  page.drawImage(barcodeImg, { x: 20, y: barcodeY, width: barcodeW, height: barcodeH });

  page.drawText(variant.lasyncro_barcode, {
    x: 20, y: barcodeY - 20,
    size: 16, font: fontBold, color: BLACK,
  });

  const caption = [variant.sku, variant.product_title ?? variant.variant_title]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 36);

  if (caption) {
    page.drawText(caption, {
      x: 20, y: barcodeY - 34,
      size: 8, font, color: GREY,
    });
  }
}

/**
 * Single product label — one page, 4x2in thermal stock.
 */
export async function generateProductLabelPdf(
  variant: ProductLabelVariant
): Promise<Buffer> {
  const doc      = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font     = await doc.embedFont(StandardFonts.Helvetica);

  await drawProductLabel(doc, variant, fontBold, font);

  return Buffer.from(await doc.save());
}

/**
 * Batch — one page per variant, same stock. Deliberately not sheet-format
 * aware: SHEET_FORMATS in warehouseLabelPdf.service.ts mirrors the
 * frontend's LABEL_FORMATS selector, which the Products tab does not yet
 * expose. Adding a format selector there is a follow-up, not a blocker
 * for the review resubmission.
 */
export async function generateProductLabelSheetPdf(
  variants: ProductLabelVariant[]
): Promise<Buffer> {
  const doc      = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font     = await doc.embedFont(StandardFonts.Helvetica);

  for (const variant of variants) {
    await drawProductLabel(doc, variant, fontBold, font);
  }

  return Buffer.from(await doc.save());
}