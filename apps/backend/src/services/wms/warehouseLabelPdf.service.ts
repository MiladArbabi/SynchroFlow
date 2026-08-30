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
  /**
   * REV-HARD-01 / REV-HARD-10 — optional merchant-supplied override for
   * pre-existing rack labels. Nullable in `warehouse_locations` and unset
   * on every row in every tenant today; the renderer falls back to
   * `location_code`. Declared here because floor-planning.controller.ts:903
   * selects it and casts the result to WarehouseLabelZone[] — omitting it
   * broke the CI build (TS2339) while local incremental builds passed.
   */
  barcode: string | null;
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

  // REV-HARD-01: honour merchant-supplied override when present.
  const barcodePng   = await generateCode128Png(zone.barcode ?? zone.location_code);
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

  // REV-HARD-01: honour merchant-supplied override when present.
  const barcodePng   = await generateCode128Png(zone.barcode ?? zone.location_code);
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

// FP-16: batch sheet formats — mirrors PrintPreviewPanel's existing
// LABEL_FORMATS config on the frontend (kept in sync manually; frontend
// is the source of truth for what the operator sees in the format
// selector, this just needs matching geometry to produce the same layout
// server-side). mm -> pt conversion: 1mm = 2.8346pt.
const MM_TO_PT = 2.8346;

interface SheetFormat {
  labelsPerSheet: number;
  columns: number;
  labelWidthMm: number;
  labelHeightMm: number;
  paperSize: 'A4' | '4x6' | '1x2';
}

const SHEET_FORMATS: Record<string, SheetFormat> = {
  'avery-5160': { labelsPerSheet: 24, columns: 3, labelWidthMm: 66,  labelHeightMm: 25,  paperSize: 'A4'  },
  'avery-5163': { labelsPerSheet: 10, columns: 2, labelWidthMm: 101, labelHeightMm: 51,  paperSize: 'A4'  },
  'zebra-4x6':  { labelsPerSheet: 1,  columns: 1, labelWidthMm: 101, labelHeightMm: 152, paperSize: '4x6' },
  'dymo-1x2':   { labelsPerSheet: 1,  columns: 1, labelWidthMm: 25,  labelHeightMm: 54,  paperSize: '1x2' },
};

function pageSizeForFormat(f: SheetFormat): [number, number] {
  if (f.paperSize === 'A4') return [A4_WIDTH, A4_HEIGHT];
  // SHOP-REVIEW-BARCODE-PRINT-05: the MediaBox is the *advertised media*, not
  // the nominal label-mm box. Zebra 4x6 = 288x432pt, Dymo 1x2.125 = 72x153pt.
  if (f.paperSize === '4x6') return [4 * 72, 6 * 72];
  return [1 * 72, 2.125 * 72];
}

// FP-16 / SHOP-REVIEW-BARCODE-PRINT-05 — batch label-sheet geometry.
//
// The layout is computed once, as pure data, by computeWarehouseLabelSheetLayout()
// and then consumed by the renderer. Tests assert the same layout the renderer
// draws, so the test/render drift that shipped the Zebra 4x6 / Dymo 1x2 clipping
// (pagination was tested, element bounds were not) cannot recur.
//
// Two layout families:
//   - TILED A4 (avery-5160, avery-5163): 8mm outer sheet margin + 2mm
//     inter-label gap, columns x rows tiled from the top. Physical Avery stock
//     is die-cut to this grid — the margin/gap are load-bearing.
//   - ONE LABEL PER PHYSICAL PAGE (zebra-4x6, dymo-1x2): the label IS the page.
//     No sheet margin, no inter-label gap. The whole MediaBox is the label
//     canvas, with only a small internal quiet-zone inset. Applying the A4
//     outer margin here pushed the label origin off the bottom of the page and
//     the barcode past the right edge.
export interface WarehouseLabelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WarehouseLabelSlotLayout {
  /** Which generated page (0-based) this label is drawn on. */
  pageIndex: number;
  /** The label box within the page. */
  frame: WarehouseLabelRect;
  /** The Code128 image rectangle. */
  barcode: WarehouseLabelRect;
  /** location_code caption draw origin + size (glyph top ~= y + fontSize). */
  caption: { x: number; y: number; fontSize: number };
}

export interface WarehouseLabelSheetLayout {
  formatId: string;
  paperSize: SheetFormat['paperSize'];
  /** Physical page / MediaBox, in PDF points. */
  page: { width: number; height: number };
  /** Labels per generated page. */
  perPage: number;
  /** Number of pages the renderer will add. */
  pageCount: number;
  /** One entry per requested label, in request order. */
  slots: WarehouseLabelSlotLayout[];
}

/** Hard internal inset for one-label-per-page thermal formats, in PDF points.
 *  Matches the 4pt convention already used inside the A4 tiled labels; the
 *  bwip-js raster (paddingwidth: 4) adds its own proportional quiet zone on
 *  top of this. */
const THERMAL_INSET_PT = 4;

/**
 * Pure, deterministic layout for the batch label sheet — geometry only, no
 * barcode content and no tenant data. Exported for automated geometry proofs;
 * it is an internal service export, not an HTTP/API contract.
 */
export function computeWarehouseLabelSheetLayout(
  formatId: string,
  count: number
): WarehouseLabelSheetLayout {
  const format = SHEET_FORMATS[formatId] ?? SHEET_FORMATS['avery-5160'];
  const [pageW, pageH] = pageSizeForFormat(format);
  const n = Math.max(0, Math.floor(count));

  const oneLabelPerPage = format.paperSize !== 'A4' && format.labelsPerSheet === 1;

  if (oneLabelPerPage) {
    // ONE LABEL PER PHYSICAL PAGE — the page is the label canvas, origin (0,0),
    // no A4 outer margin, no inter-row gap. Internal quiet-zone inset only.
    const inset = THERMAL_INSET_PT;
    const barcodeH = pageH * 0.6;
    const slots: WarehouseLabelSlotLayout[] = [];
    for (let j = 0; j < n; j++) {
      slots.push({
        pageIndex: j,
        frame: { x: 0, y: 0, width: pageW, height: pageH },
        barcode: {
          x: inset,
          y: pageH - barcodeH - inset,
          width: pageW - inset * 2,
          height: barcodeH,
        },
        caption: { x: inset, y: inset + 2, fontSize: Math.min(10, pageH * 0.15) },
      });
    }
    return {
      formatId,
      paperSize: format.paperSize,
      page: { width: pageW, height: pageH },
      perPage: 1,
      pageCount: n,
      slots,
    };
  }

  // TILED A4 — geometry unchanged (avery-5160 stays coordinate-equivalent).
  const labelWpt = format.labelWidthMm * MM_TO_PT;
  const labelHpt = format.labelHeightMm * MM_TO_PT;
  const marginPt = 8 * MM_TO_PT;
  const gapPt    = 2 * MM_TO_PT;
  const perPage  = format.labelsPerSheet;
  const barcodeH = labelHpt * 0.6;
  const slots: WarehouseLabelSlotLayout[] = [];
  for (let j = 0; j < n; j++) {
    const onPage = j % perPage;
    const col = onPage % format.columns;
    const row = Math.floor(onPage / format.columns);
    const x = marginPt + col * (labelWpt + gapPt);
    const y = pageH - marginPt - (row + 1) * (labelHpt + gapPt);
    slots.push({
      pageIndex: Math.floor(j / perPage),
      frame: { x, y, width: labelWpt, height: labelHpt },
      barcode: { x: x + 4, y: y + labelHpt - barcodeH - 4, width: labelWpt - 8, height: barcodeH },
      caption: { x: x + 4, y: y + 6, fontSize: Math.min(10, labelHpt * 0.15) },
    });
  }
  return {
    formatId,
    paperSize: format.paperSize,
    page: { width: pageW, height: pageH },
    perPage,
    pageCount: Math.ceil(n / perPage),
    slots,
  };
}

export async function generateWarehouseLabelSheetPdf(
  zones: WarehouseLabelZone[],
  formatId: string
): Promise<Buffer> {
  // Compute the geometry once, then draw exactly what was computed — the same
  // layout the geometry tests assert against.
  const layout = computeWarehouseLabelSheetLayout(formatId, zones.length);
  const doc  = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);

  const pages = Array.from({ length: layout.pageCount }, () =>
    doc.addPage([layout.page.width, layout.page.height]));

  for (let j = 0; j < zones.length; j++) {
    const zone = zones[j];
    const slot = layout.slots[j];
    const page = pages[slot.pageIndex];

    // REV-HARD-01: honour merchant-supplied override when present.
    const barcodePng   = await generateCode128Png(zone.barcode ?? zone.location_code);
    const barcodeImage = await doc.embedPng(barcodePng);

    page.drawImage(barcodeImage, {
      x: slot.barcode.x,
      y: slot.barcode.y,
      width: slot.barcode.width,
      height: slot.barcode.height,
    });
    page.drawText(zone.location_code, {
      x: slot.caption.x,
      y: slot.caption.y,
      size: slot.caption.fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  }

  return Buffer.from(await doc.save());
}
