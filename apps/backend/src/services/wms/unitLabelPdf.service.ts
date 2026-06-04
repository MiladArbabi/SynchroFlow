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
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import bwipjs from 'bwip-js';
import { Knex } from 'knex';

// 50mm × 25mm in points (1mm = 2.8346pt)
const LABEL_W = 141.73;
const LABEL_H =  70.87;
const BLACK   = rgb(0, 0, 0);
const GREY    = rgb(0.45, 0.45, 0.45);

async function generateCode128Png(value: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer(
      {
        bcid: 'code128',
        text: value,
        scale: 2,
        height: 10,
        includetext: false,
        paddingwidth: 4,
        paddingheight: 2,
      },
      (err, png) => { if (err) reject(err); else resolve(png); }
    );
  });
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

    // Barcode
    const barcodePng = await generateCode128Png(unit.lasyncro_unit_id);
    const barcodeImg = await doc.embedPng(barcodePng);
    const barcodeW   = LABEL_W - 16;
    const barcodeH   = barcodeImg.height * (barcodeW / barcodeImg.width);
    const barcodeY   = LABEL_H - barcodeH - 8;

    page.drawImage(barcodeImg, { x: 8, y: barcodeY, width: barcodeW, height: barcodeH });

    // LSU- id — human readable below barcode
    page.drawText(unit.lasyncro_unit_id, {
      x: 8, y: barcodeY - 11,
      size: 7, font: mono, color: BLACK,
    });

    // SKU + variant
    const label = [unit.sku, unit.variant_title]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 36);

    if (label) {
      page.drawText(label, {
        x: 8, y: barcodeY - 21,
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