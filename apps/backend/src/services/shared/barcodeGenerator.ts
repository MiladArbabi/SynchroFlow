// apps/backend/src/services/shared/barcodeGenerator.ts
//
// FP-15 — Shared Code128 barcode rasterizer
// -------------------------------------------
// Extracted from invoicePdf.service.ts so warehouseLabelPdf.service.ts can
// reuse the exact same proven generation path instead of duplicating it.
// Server-side rasterization (bwip-js -> PNG) avoids the print-blank bug
// that affected the old client-side JsBarcode/SVG approach — SVGs without
// an explicit viewBox don't reliably resolve height:auto in print output,
// PNGs embedded in a PDF always do.
import bwipjs from 'bwip-js';

export async function generateCode128Png(value: string): Promise<Buffer> {
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