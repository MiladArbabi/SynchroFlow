// apps/backend/src/services/wms/warehouseLabelPdf.service.ts
//
// FP-15 — Warehouse Location Label PDF Generator
// -------------------------------------------------
// First sub-issue of GitHub #1047 (Unified Printing System). Replaces the
// old client-side JsBarcode/SVG path that rendered fine on-screen but
// printed blank (missing viewBox on an SVG relying on height:auto). Follows
// the same server-rendered pattern as invoicePdf.service.ts.
//
// Two formats, chosen by zone.type:
//   - 'bin' (and all other non-frame types): small Code128 label, sized for
//     thermal label stock.
//   - 'lane': A4 directional placard — larger, includes zone_type and a
//     list of child bin codes for operator wayfinding to a full aisle.
//
// Scope note: this covers single-zone generation only. Batch print (from
// the Barcodes tab) and printViaQz delivery-layer wiring are separate,
// later sub-issues under #1047 — kept out of this pass deliberately so
// generation and delivery aren't mixed in one change.
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { generateCode128Png } from '../shared/barcodeGenerator.js';

export interface WarehouseLabelZone {
  location_code: string;
  type: string;
  zone_type: string | null;
}

const LABEL_WIDTH  = 288; // 4in thermal label stock, in points (72pt/in)
const LABEL_HEIGHT = 144; // 2in
const A4_WIDTH  = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 40;

async function generateBinLabel(zone: WarehouseLabelZone): Promise<Buffer> {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([LABEL_WIDTH, LABEL_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);

  const barcodePng   = await generateCode128Png(zone.location_code);
  const barcodeImage = await doc.embedPng(barcodePng);
  const barcodeWidth  = LABEL_WIDTH - 40;
  const barcodeHeight = 60;

  page.drawImage(barcodeImage, {
    x: 20,
    y: LABEL_HEIGHT - barcodeHeight - 20,
    width: barcodeWidth,
    height: barcodeHeight,
  });

  page.drawText(zone.location_code, {
    x: 20,
    y: 20,
    size: 18,
    font,
    color: rgb(0, 0, 0),
  });

  return Buffer.from(await doc.save());
}

async function generateLanePlacard(
  zone: WarehouseLabelZone,
  childBinCodes: string[]
): Promise<Buffer> {
  const doc      = await PDFDocument.create();
  const page     = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font     = await doc.embedFont(StandardFonts.Helvetica);

  let y = A4_HEIGHT - MARGIN;

  page.drawText(zone.location_code, {
    x: MARGIN,
    y: y - 60,
    size: 64,
    font: fontBold,
    color: rgb(0, 0, 0),
  });
  y -= 90;

  if (zone.zone_type) {
    page.drawText(zone.zone_type.toUpperCase(), {
      x: MARGIN,
      y,
      size: 16,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
    y -= 30;
  }

  const barcodePng   = await generateCode128Png(zone.location_code);
  const barcodeImage = await doc.embedPng(barcodePng);
  const barcodeWidth  = A4_WIDTH - MARGIN * 2;
  const barcodeHeight = 80;
  y -= barcodeHeight;

  page.drawImage(barcodeImage, {
    x: MARGIN,
    y,
    width: barcodeWidth,
    height: barcodeHeight,
  });
  y -= 40;

  if (childBinCodes.length > 0) {
    page.drawText('BIN LOCATIONS', {
      x: MARGIN,
      y,
      size: 12,
      font: fontBold,
      color: rgb(0.4, 0.4, 0.4),
    });
    y -= 24;

    const perRow = 6;
    for (let i = 0; i < childBinCodes.length; i += perRow) {
      const row = childBinCodes.slice(i, i + perRow).join('   ');
      page.drawText(row, {
        x: MARGIN,
        y,
        size: 14,
        font,
        color: rgb(0, 0, 0),
      });
      y -= 22;
    }
  }

  return Buffer.from(await doc.save());
}

export async function generateWarehouseLabelPdf(
  zone: WarehouseLabelZone,
  childBinCodes: string[] = []
): Promise<Buffer> {
  if (zone.type === 'lane') {
    return generateLanePlacard(zone, childBinCodes);
  }
  return generateBinLabel(zone);
}
