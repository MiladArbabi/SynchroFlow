// apps/backend/src/services/wms/unitLabelPdf.service.ts
//
// WM-46 — Unit Label PDF Generator
// ----------------------------------
// Generates a thermal-format PDF (50mm × 25mm per page) for LSU- unit labels.
// One page per unit — operator prints to thermal printer from browser dialog.
//
// Label layout per page:
//   [Code128 barcode — LSU- value]
//   [LSU- id text]
//   [SKU · variant title]
//
// Uses same bwip-js + pdf-lib stack as invoicePdf.service.ts (WM-34).
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import bwipjs from 'bwip-js';
import { Knex } from 'knex';

// 50mm × 25mm in points (1mm = 2.8346pt)
const LABEL_W = 141.73;
const LABEL_H =  70.87;
const BLACK   = rgb(0, 0, 0);
const GREY    = rgb(0.45, 0.45, 0.45);
const MARGIN  = 8;

// GH-1255 — barcode geometry in whole thermal-printer dots. A module is an
// exact multiple of one 203-dpi dot, so a 203-dpi printer at 100% scale
// renders every bar with the same integer width instead of resampling it.
// At least 10X quiet zone each side; bars have an explicit height.
const TARGET_DPI           = 203;
const DOT_PT               = 72 / TARGET_DPI;
const MAX_DOTS_PER_MODULE  = 3;
const QUIET_ZONE_MODULES   = 10;
const BAR_HEIGHT_PT        = 28.35; // 10mm

function renderCode128(value: string, scale: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer(
      { bcid: 'code128', text: value, scale, height: 10, includetext: false, paddingwidth: 0, paddingheight: 0 },
      (err, png) => { if (err) reject(err); else resolve(png); }
    );
  });
}

const pngWidth = (png: Buffer) => png.readUInt32BE(16);

/** Largest whole number of dots per module that fits the label with quiet zones, or 0. */
function dotsPerModule(modules: number): number {
  for (let dots = MAX_DOTS_PER_MODULE; dots >= 1; dots -= 1) {
    if ((modules + 2 * QUIET_ZONE_MODULES) * dots * DOT_PT <= LABEL_W) return dots;
  }
  return 0;
}

/** Largest font size (<= max) at which text fits the label between margins. */
function fittedSize(font: PDFFont, text: string, max: number): number {
  const available = LABEL_W - 2 * MARGIN;
  const width = font.widthOfTextAtSize(text, max);
  return width <= available ? max : max * (available / width);
}

/** Longest prefix of text that fits between margins at the given size. */
function fittedText(font: PDFFont, text: string, size: number): string {
  const available = LABEL_W - 2 * MARGIN;
  let fitted = text;
  while (fitted && font.widthOfTextAtSize(fitted, size) > available) fitted = fitted.slice(0, -1);
  return fitted;
}

export interface UnitLabelInput {
  lasyncro_unit_id: string;
  receive_sequence: number;
  sku: string | null;
  variant_title: string | null;
}

/**
 * Generates a multi-page PDF — one 50×25mm page per unit.
 * Caller must ensure units belong to the correct shop (RLS enforced upstream).
 */
export async function generateUnitLabelPdf(units: UnitLabelInput[]): Promise<Uint8Array> {
  const doc  = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  for (const unit of units) {
    const page = doc.addPage([LABEL_W, LABEL_H]);

    // Barcode — one image pixel per printer dot at TARGET_DPI.
    const modules = pngWidth(await renderCode128(unit.lasyncro_unit_id, 1));
    const dots = dotsPerModule(modules);
    let barcodeW: number;
    let barcodePng: Buffer;
    if (dots > 0) {
      barcodePng = await renderCode128(unit.lasyncro_unit_id, dots);
      if (pngWidth(barcodePng) !== modules * dots) {
        throw new Error(`[UNIT_LABEL_GEOMETRY] ${unit.lasyncro_unit_id}: expected ${modules * dots}px barcode, got ${pngWidth(barcodePng)}px`);
      }
      barcodeW = modules * dots * DOT_PT;
    } else {
      // Longer than any whole-dot module allows: keep the previous fit-to-width
      // label rather than refusing to print an existing identity.
      console.warn('[UNIT_LABEL] barcode below one printer dot per module', { lasyncro_unit_id: unit.lasyncro_unit_id, modules });
      barcodePng = await renderCode128(unit.lasyncro_unit_id, 2);
      barcodeW = LABEL_W - 2 * MARGIN;
    }
    const barcodeImg = await doc.embedPng(barcodePng);
    const barcodeX   = (LABEL_W - barcodeW) / 2;
    const barcodeY   = LABEL_H - BAR_HEIGHT_PT - MARGIN;

    page.drawImage(barcodeImg, { x: barcodeX, y: barcodeY, width: barcodeW, height: BAR_HEIGHT_PT });

    // LSU- id — human readable below barcode
    const idSize = fittedSize(mono, unit.lasyncro_unit_id, 7);
    page.drawText(unit.lasyncro_unit_id, {
      x: (LABEL_W - mono.widthOfTextAtSize(unit.lasyncro_unit_id, idSize)) / 2, y: barcodeY - 11,
      size: idSize, font: mono, color: BLACK,
    });

    // SKU + variant
    const label = fittedText(font, [unit.sku, unit.variant_title]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 36), 6);

    if (label) {
      page.drawText(label, {
        x: MARGIN, y: barcodeY - 21,
        size: 6, font, color: GREY,
      });
    }
  }

  return doc.save();
}

/**
 * Fetches units for a receive job line and their variant context,
 * then generates the label PDF.
 * Returns null if no units found (not yet confirmed).
 */
export async function generateUnitLabelsForLine(
  trx: Knex | Knex.Transaction,
  shopId: number,
  receiveJobLineId: string
): Promise<Uint8Array | null> {
  const units = await trx('inventory_units as iu')
    .join('variants as v', 'v.lasyncro_variant_id', 'iu.lasyncro_variant_id')
    .where({ 'iu.shop_id': shopId, 'iu.receive_job_line_id': receiveJobLineId })
    .orderBy('iu.receive_sequence', 'asc')
    .select(
      'iu.lasyncro_unit_id',
      'iu.receive_sequence',
      'v.sku',
      'v.title as variant_title'
    );

  if (!units.length) return null;

  return generateUnitLabelPdf(units);
}