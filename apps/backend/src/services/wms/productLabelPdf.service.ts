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
//
// SHOP-REV-01m (2026-08-04): geometry corrected from 288x144pt (4x2in) to a
// format table defaulting to thermal-50x25. The original size was unit-label
// and shipping stock — for one code plus a short caption it wasted media and
// would not fit a small carton face or a shelf-edge rail. Product labels are
// 30-60mm by convention; 50x25mm matches the stock unitLabelPdf.service.ts
// already prints LSU- labels on, so one roll serves both.
//
// PRODUCT_FORMATS must stay in sync with LABEL_FORMATS in the frontend
// PrintPreviewPanel — the operator's selector is the contract, this is the
// matching geometry. Location formats are deliberately NOT reused: Zebra 4x6
// (101x152mm) has no product use.

import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { generateCode128Png } from '../shared/barcodeGenerator.js';

export interface ProductLabelVariant {
  lasyncro_variant_id: string;
  lasyncro_barcode: string;
  sku: string | null;
  product_title: string | null;
  variant_title: string | null;
}

// SHOP-REV-01m: was 288x144pt (4x2in) — unit-label and shipping stock, far
// too large for a single code plus a short caption. Product labels are
// 30-60mm by convention; 50x25mm is the default because it matches the
// thermal stock unitLabelPdf.service.ts already prints LSU- labels on, so one
// roll serves both and operators buy one consumable.
// 1mm = 2.8346pt.
const MM_TO_PT = 2.8346;
const MARGIN = 8 * MM_TO_PT;

interface ProductLabelFormat {
  labelsPerSheet: number;
  columns: number;
  labelWidthMm: number;
  labelHeightMm: number;
  paperSize: 'A4' | 'thermal';
}

// Mirrors SHEET_FORMATS in warehouseLabelPdf.service.ts, but product-specific:
// location formats top out at 101x152mm (Zebra 4x6) which no product label
// needs. Frontend LABEL_FORMATS must stay in sync — the selector the operator
// sees is the source of truth for labels, this is the matching geometry.
const PRODUCT_FORMATS: Record<string, ProductLabelFormat> = {
  'thermal-50x25': { labelsPerSheet: 1,  columns: 1, labelWidthMm: 50, labelHeightMm: 25, paperSize: 'thermal' },
  'dymo-1x2':      { labelsPerSheet: 1,  columns: 1, labelWidthMm: 25, labelHeightMm: 54, paperSize: 'thermal' },
  'avery-5160':    { labelsPerSheet: 24, columns: 3, labelWidthMm: 66, labelHeightMm: 25, paperSize: 'A4'      },
};

const DEFAULT_FORMAT = 'thermal-50x25';
const A4_WIDTH  = 595.28;
const A4_HEIGHT = 841.89;
const BLACK = rgb(0, 0, 0);
const GREY  = rgb(0.4, 0.4, 0.4);

async function drawProductLabel(
  page: PDFPage, variant: ProductLabelVariant, doc: PDFDocument,
  x: number, y: number, w: number, h: number,
  fontBold: PDFFont, font: PDFFont
): Promise<void> {
  const barcodePng = await generateCode128Png(variant.lasyncro_barcode);
  const barcodeImg = await doc.embedPng(barcodePng);
  const barcodeW   = w - 12;
  const barcodeH   = Math.min(barcodeImg.height * (barcodeW / barcodeImg.width), h * 0.5);
  const barcodeY   = y + h - barcodeH - 6;

  page.drawImage(barcodeImg, { x: x + 6, y: barcodeY, width: barcodeW, height: barcodeH });

  page.drawText(variant.lasyncro_barcode, {
    x: x + 6, y: barcodeY - 10, size: 8, font: fontBold, color: BLACK,
  });

  const caption = [variant.sku, variant.product_title ?? variant.variant_title]
    .filter(Boolean).join(' · ').slice(0, 36);

  if (caption) {
    page.drawText(caption, { x: x + 6, y: barcodeY - 19, size: 6, font, color: GREY });
  }
}

/**
/**
 * Single product label. Defaults to 50x25mm thermal — the stock
 * unitLabelPdf.service.ts already prints LSU- labels on.
 */
export async function generateProductLabelPdf(
  variant: ProductLabelVariant,
  formatId: string = DEFAULT_FORMAT
): Promise<Buffer> {
  const fmt      = PRODUCT_FORMATS[formatId] ?? PRODUCT_FORMATS[DEFAULT_FORMAT];
  const doc      = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font     = await doc.embedFont(StandardFonts.Helvetica);

  const w = fmt.labelWidthMm  * MM_TO_PT;
  const h = fmt.labelHeightMm * MM_TO_PT;

  if (fmt.paperSize === 'A4') {
    const page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
    await drawProductLabel(page, variant, doc, MARGIN, A4_HEIGHT - MARGIN - h, w, h, fontBold, font);
  } else {
    const page = doc.addPage([w, h]);
    await drawProductLabel(page, variant, doc, 0, 0, w, h, fontBold, font);
  }

  return Buffer.from(await doc.save());
}

/**
 * Batch. Thermal formats emit one page per label (roll printers advance per
 * page); A4 formats tile a grid, mirroring generateWarehouseLabelSheetPdf.
 */
export async function generateProductLabelSheetPdf(
  variants: ProductLabelVariant[],
  formatId: string = DEFAULT_FORMAT
): Promise<Buffer> {
  const fmt      = PRODUCT_FORMATS[formatId] ?? PRODUCT_FORMATS[DEFAULT_FORMAT];
  const doc      = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font     = await doc.embedFont(StandardFonts.Helvetica);

  const w = fmt.labelWidthMm  * MM_TO_PT;
  const h = fmt.labelHeightMm * MM_TO_PT;

  if (fmt.paperSize !== 'A4') {
    for (const variant of variants) {
      const page = doc.addPage([w, h]);
      await drawProductLabel(page, variant, doc, 0, 0, w, h, fontBold, font);
    }
    return Buffer.from(await doc.save());
  }

  const gapPt = 2 * MM_TO_PT;
  for (let i = 0; i < variants.length; i += fmt.labelsPerSheet) {
    const page  = doc.addPage([A4_WIDTH, A4_HEIGHT]);
    const sheet = variants.slice(i, i + fmt.labelsPerSheet);

    for (let j = 0; j < sheet.length; j++) {
      const col = j % fmt.columns;
      const row = Math.floor(j / fmt.columns);
      const x = MARGIN + col * (w + gapPt);
      const y = A4_HEIGHT - MARGIN - (row + 1) * (h + gapPt);
      await drawProductLabel(page, sheet[j], doc, x, y, w, h, fontBold, font);
    }
  }

  return Buffer.from(await doc.save());
}