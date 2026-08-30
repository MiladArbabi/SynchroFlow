/**
 * SHOP-REVIEW-BARCODE-PRINT-05 — thermal location-label geometry + caption composition.
 *
 * The production incident (Zebra 4x6 barcode clipped at the page edge, caption
 * pushed off the bottom) escaped because PDF *pagination* was tested but no test
 * asserted that drawn elements stay inside the MediaBox. `generateWarehouseLabelSheetPdf`
 * now computes its structural layout once via the pure `computeWarehouseLabelSheetLayout`
 * helper and draws exactly that.
 *
 * Follow-up (thermal caption composition): the thermal caption is centred under
 * the barcode with a fixed 6pt visual gap and shrinks to fit the barcode width.
 * Structural values (centre, gap, font-size limits) live in the pure helper;
 * text-dependent placement (final size, x, baseline) is resolved by the renderer
 * from the embedded font. These tests exercise the *same* helpers the renderer
 * uses — `fitThermalCaptionFontSize`, `computeCenteredCaptionX`,
 * `computeThermalCaptionBaselineY` — with the real embedded HelveticaBold. No
 * PDF parsing, no OCR.
 */
import { PDFDocument, PDFFont, StandardFonts } from 'pdf-lib';
import {
  computeWarehouseLabelSheetLayout,
  fitThermalCaptionFontSize,
  computeCenteredCaptionX,
  computeThermalCaptionBaselineY,
  type WarehouseLabelRect,
  type WarehouseLabelSheetLayout,
  type WarehouseLabelCaptionLayout,
} from 'api-src/services/wms/warehouseLabelPdf.service';

const EPS = 1e-6;

let font: PDFFont;
beforeAll(async () => {
  const doc = await PDFDocument.create();
  font = await doc.embedFont(StandardFonts.HelveticaBold);
});

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
  return [];
}

function expectRectInsidePage(rect: WarehouseLabelRect, layout: WarehouseLabelSheetLayout, label: string) {
  const { width: pageW, height: pageH } = layout.page;
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(pageW + EPS);
  expect(rect.y + rect.height).toBeLessThanOrEqual(pageH + EPS);
  void label;
}

/** Mirror of the renderer's thermal-caption resolution — same helpers, same font. */
function resolveThermalCaption(cap: Extract<WarehouseLabelCaptionLayout, { mode: 'thermal-centered' }>, code: string) {
  const fit = fitThermalCaptionFontSize({
    text: code,
    maxSize: cap.maxFontSize,
    minSize: cap.minFontSize,
    maxWidth: cap.maxWidth,
    measure: (t, s) => font.widthOfTextAtSize(t, s),
  });
  if (!fit.fits) return { fits: false as const, fit };
  const ascent = font.heightAtSize(fit.fontSize, { descender: false });
  const x = computeCenteredCaptionX(cap.centerX, fit.textWidth);
  const y = computeThermalCaptionBaselineY(cap.barcodeBottom, cap.gapPt, ascent);
  return { fits: true as const, fontSize: fit.fontSize, textWidth: fit.textWidth, ascent, x, y };
}

function thermalCap(formatId: string) {
  const slot = computeWarehouseLabelSheetLayout(formatId, 1).slots[0];
  if (slot.caption.mode !== 'thermal-centered') throw new Error('expected thermal-centered caption');
  return { slot, cap: slot.caption };
}

// Ordinary supported location codes. WH-<shopId>-ROOT is created for every
// tenant at FT2; production shopIds run to 6 digits.
const DYMO_FIXTURE_CODES = [
  'A', 'B', 'PACK-01', 'PICK-0A-02',
  'WH-1-ROOT', 'WH-999-ROOT', 'WH-12345-ROOT', 'WH-123456-ROOT',
];

describe('computeWarehouseLabelSheetLayout — thermal one-label-per-page', () => {
  describe('zebra-4x6', () => {
    it('TG1 — MediaBox is exactly 288 x 432 pt (4x6in), one page per label', () => {
      expect(computeWarehouseLabelSheetLayout('zebra-4x6', 1).page).toEqual({ width: 288, height: 432 });
      expect(computeWarehouseLabelSheetLayout('zebra-4x6', 1).pageCount).toBe(1);

      const three = computeWarehouseLabelSheetLayout('zebra-4x6', 3);
      expect(three.page).toEqual({ width: 288, height: 432 });
      expect(three.perPage).toBe(1);
      expect(three.pageCount).toBe(3);
      expect(three.slots).toHaveLength(3);
      expect(three.slots.map((s) => s.pageIndex)).toEqual([0, 1, 2]);
    });

    it('TG2 — barcode + frame inside the page; resolved caption inside the page for every fixture code', () => {
      const layout = computeWarehouseLabelSheetLayout('zebra-4x6', 3);
      for (const slot of layout.slots) {
        expect(slot.frame).toEqual({ x: 0, y: 0, width: 288, height: 432 });
        expectRectInsidePage(slot.barcode, layout, 'zebra barcode');
        expect(slot.caption.mode).toBe('thermal-centered');
        if (slot.caption.mode !== 'thermal-centered') continue;
        for (const code of DYMO_FIXTURE_CODES) {
          const r = resolveThermalCaption(slot.caption, code);
          expect(r.fits).toBe(true);
          if (!r.fits) continue;
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.x + r.textWidth).toBeLessThanOrEqual(layout.page.width + EPS);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.y + r.ascent).toBeLessThanOrEqual(layout.page.height + EPS);
        }
      }
    });

    it('TG3 — barcode keeps a positive left and right quiet-zone inset (not edge-to-edge)', () => {
      const { slots, page } = computeWarehouseLabelSheetLayout('zebra-4x6', 1);
      const bc = slots[0].barcode;
      expect(bc.x).toBeGreaterThanOrEqual(4);
      expect(page.width - (bc.x + bc.width)).toBeGreaterThanOrEqual(4);
      expect(bc.x + bc.width).toBeLessThanOrEqual(284);
    });

    it('TG4 — resolved caption sits below the barcode with no vertical overlap', () => {
      const { cap, slot } = thermalCap('zebra-4x6');
      for (const code of DYMO_FIXTURE_CODES) {
        const r = resolveThermalCaption(cap, code);
        expect(r.fits).toBe(true);
        if (!r.fits) continue;
        expect(r.y + r.ascent).toBeLessThanOrEqual(slot.barcode.y + EPS);
      }
    });
  });

  describe('dymo-1x2', () => {
    it('TG5 — MediaBox is exactly 72 x 153 pt (1x2.125in), one page per label', () => {
      expect(computeWarehouseLabelSheetLayout('dymo-1x2', 1).page).toEqual({ width: 72, height: 153 });
      expect(computeWarehouseLabelSheetLayout('dymo-1x2', 1).pageCount).toBe(1);

      const three = computeWarehouseLabelSheetLayout('dymo-1x2', 3);
      expect(three.perPage).toBe(1);
      expect(three.pageCount).toBe(3);
      expect(three.slots.map((s) => s.pageIndex)).toEqual([0, 1, 2]);
    });

    it('TG6 — barcode inside the page with a positive left/right inset; resolved caption inside the page + no overlap', () => {
      const layout = computeWarehouseLabelSheetLayout('dymo-1x2', 3);
      for (const slot of layout.slots) {
        expect(slot.frame).toEqual({ x: 0, y: 0, width: 72, height: 153 });
        expectRectInsidePage(slot.barcode, layout, 'dymo barcode');
        expect(slot.barcode.x).toBeGreaterThanOrEqual(4);
        expect(layout.page.width - (slot.barcode.x + slot.barcode.width)).toBeGreaterThanOrEqual(4);
        if (slot.caption.mode !== 'thermal-centered') throw new Error('expected thermal caption');
        for (const code of DYMO_FIXTURE_CODES) {
          const r = resolveThermalCaption(slot.caption, code);
          expect(r.fits).toBe(true);
          if (!r.fits) continue;
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.x + r.textWidth).toBeLessThanOrEqual(layout.page.width + EPS);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.y + r.ascent).toBeLessThanOrEqual(slot.barcode.y + EPS);
        }
      }
    });

    it('applies no A4 outer margin or inter-row gap (label origin is 0,0)', () => {
      const { slots } = computeWarehouseLabelSheetLayout('dymo-1x2', 2);
      slots.forEach((s) => {
        expect(s.frame.x).toBe(0);
        expect(s.frame.y).toBe(0);
      });
    });
  });
});

describe('SHOP-REVIEW-BARCODE-PRINT-05 — thermal caption composition (CC1–CC12)', () => {
  it('TC1 — Zebra thermal caption structural centerX = 144 (barcode midpoint)', () => {
    const { cap, slot } = thermalCap('zebra-4x6');
    expect(cap.mode).toBe('thermal-centered');
    expect(cap.centerX).toBe(144);
    expect(cap.centerX).toBeCloseTo(slot.barcode.x + slot.barcode.width / 2, 10);
    expect(cap.gapPt).toBe(6);
    expect(cap.maxFontSize).toBe(10);
    expect(cap.minFontSize).toBe(5);
    expect(cap.maxWidth).toBeCloseTo(280, 6);
  });

  it('TC2 — Zebra resolved caption: visual gap is exactly 6 pt', () => {
    const { cap, slot } = thermalCap('zebra-4x6');
    for (const code of ['A', 'PICK-0A-02', 'WH-123456-ROOT']) {
      const r = resolveThermalCaption(cap, code);
      expect(r.fits).toBe(true);
      if (!r.fits) continue;
      const visualGap = slot.barcode.y - (r.y + r.ascent);
      expect(visualGap).toBeCloseTo(6, 6);
    }
  });

  it('TC3 — Dymo thermal caption structural centerX = 36 (barcode midpoint)', () => {
    const { cap, slot } = thermalCap('dymo-1x2');
    expect(cap.centerX).toBe(36);
    expect(cap.centerX).toBeCloseTo(slot.barcode.x + slot.barcode.width / 2, 10);
    expect(cap.maxWidth).toBeCloseTo(64, 6);
    expect(cap.gapPt).toBe(6);
  });

  it('TC4 — Dymo resolved caption: visual gap is exactly 6 pt (10pt code and a shrunk code)', () => {
    const { cap, slot } = thermalCap('dymo-1x2');
    for (const code of ['WH-1-ROOT', 'WH-12345-ROOT']) {
      const r = resolveThermalCaption(cap, code);
      expect(r.fits).toBe(true);
      if (!r.fits) continue;
      expect(slot.barcode.y - (r.y + r.ascent)).toBeCloseTo(6, 6);
    }
  });

  it('TC5 — resolved caption is fully inside the page (Zebra + Dymo, all fixtures)', () => {
    for (const formatId of ['zebra-4x6', 'dymo-1x2']) {
      const layout = computeWarehouseLabelSheetLayout(formatId, 1);
      const slot = layout.slots[0];
      if (slot.caption.mode !== 'thermal-centered') throw new Error('expected thermal caption');
      for (const code of DYMO_FIXTURE_CODES) {
        const r = resolveThermalCaption(slot.caption, code);
        expect(r.fits).toBe(true);
        if (!r.fits) continue;
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.textWidth).toBeLessThanOrEqual(layout.page.width + EPS);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.y + r.ascent).toBeLessThanOrEqual(layout.page.height + EPS);
      }
    }
  });

  it('TC6 — thermal barcode rectangles are exactly the certified values (unchanged)', () => {
    const z = computeWarehouseLabelSheetLayout('zebra-4x6', 1).slots[0].barcode;
    expect(z.x).toBe(4);
    expect(z.y).toBeCloseTo(168.8, 6);
    expect(z.width).toBe(280);
    expect(z.height).toBeCloseTo(259.2, 6);

    const d = computeWarehouseLabelSheetLayout('dymo-1x2', 1).slots[0].barcode;
    expect(d.x).toBe(4);
    expect(d.y).toBeCloseTo(57.2, 6);
    expect(d.width).toBe(64);
    expect(d.height).toBeCloseTo(91.8, 6);
  });

  it('TC7 — Avery captions unchanged: mode "fixed", left-aligned, no centering fields', () => {
    for (const formatId of ['avery-5160', 'avery-5163']) {
      const cap = computeWarehouseLabelSheetLayout(formatId, 1).slots[0].caption;
      expect(cap.mode).toBe('fixed');
      if (cap.mode !== 'fixed') continue;
      expect(typeof cap.x).toBe('number');
      expect(typeof cap.y).toBe('number');
      expect(typeof cap.fontSize).toBe('number');
      expect((cap as Record<string, unknown>).centerX).toBeUndefined();
      expect((cap as Record<string, unknown>).gapPt).toBeUndefined();
    }
    // exact pre-existing avery-5160 first-label caption y (mm -> pt at 2.8346)
    const cap0 = computeWarehouseLabelSheetLayout('avery-5160', 1).slots[0].caption;
    if (cap0.mode !== 'fixed') throw new Error('expected fixed caption');
    expect(cap0.x).toBeCloseTo(8 * 2.8346 + 4, 6);
    expect(cap0.y).toBeCloseTo(841.89 - 8 * 2.8346 - (25 * 2.8346 + 2 * 2.8346) + 6, 6);
    expect(cap0.fontSize).toBeCloseTo(Math.min(10, 25 * 2.8346 * 0.15), 6);
  });

  it('TC10 — every ordinary fixture code fits on Dymo at >= 5 pt with the complete text', () => {
    const { cap } = thermalCap('dymo-1x2');
    for (const code of DYMO_FIXTURE_CODES) {
      const r = resolveThermalCaption(cap, code);
      expect(r.fits).toBe(true);
      if (!r.fits) continue;
      expect(r.fontSize).toBeGreaterThanOrEqual(5);
      expect(r.fontSize).toBeLessThanOrEqual(10);
      // width is measured for the WHOLE string at the final size (no truncation)
      expect(r.textWidth).toBeCloseTo(font.widthOfTextAtSize(code, r.fontSize), 6);
      expect(r.textWidth).toBeLessThanOrEqual(cap.maxWidth + EPS);
    }
  });

  it('TC11 — resolved caption midpoint equals the barcode midpoint within epsilon', () => {
    for (const formatId of ['zebra-4x6', 'dymo-1x2']) {
      const { cap } = thermalCap(formatId);
      for (const code of DYMO_FIXTURE_CODES) {
        const r = resolveThermalCaption(cap, code);
        expect(r.fits).toBe(true);
        if (!r.fits) continue;
        expect(Math.abs(r.x + r.textWidth / 2 - cap.centerX)).toBeLessThanOrEqual(1e-9);
      }
    }
  });

  it('TC12 — a long root code shrinks below 10 pt but stays >= 5 pt with the whole string intact', () => {
    const { cap } = thermalCap('dymo-1x2');
    const r = resolveThermalCaption(cap, 'WH-12345-ROOT');
    expect(r.fits).toBe(true);
    if (!r.fits) return;
    expect(r.fontSize).toBeLessThan(10);
    expect(r.fontSize).toBeGreaterThanOrEqual(5);
    expect(r.textWidth).toBeLessThanOrEqual(cap.maxWidth + EPS);
    expect(r.textWidth).toBeCloseTo(font.widthOfTextAtSize('WH-12345-ROOT', r.fontSize), 6);
  });

  it('TC13 — a synthetic over-long string returns an explicit no-fit result (never overflows)', () => {
    const { cap } = thermalCap('dymo-1x2');
    const extreme = 'X'.repeat(40); // ~144pt at 5pt on a 64pt caption width
    const fit = fitThermalCaptionFontSize({
      text: extreme,
      maxSize: cap.maxFontSize,
      minSize: cap.minFontSize,
      maxWidth: cap.maxWidth,
      measure: (t, s) => font.widthOfTextAtSize(t, s),
    });
    expect(fit.fits).toBe(false);
    if (fit.fits) return;
    expect(fit.minFontSize).toBe(5);
    expect(fit.textWidthAtMin).toBeGreaterThan(cap.maxWidth);
    expect(fit.maxWidth).toBeCloseTo(64, 6);
  });

  it('fitThermalCaptionFontSize — pure behaviour with a synthetic linear measure', () => {
    // linear measure: width = length * size * k
    const k = 0.6;
    const measure = (t: string, s: number) => t.length * s * k;
    // 5 chars @ 10pt @ k=0.6 = 30 <= 64 -> stays at max
    expect(fitThermalCaptionFontSize({ text: 'ABCDE', maxSize: 10, minSize: 5, maxWidth: 64, measure }))
      .toEqual({ fits: true, fontSize: 10, textWidth: 30 });
    // 20 chars @ 10pt = 120 > 64 -> shrink; 64/120*10 = 5.333.. -> ~5.33
    const shrunk = fitThermalCaptionFontSize({ text: 'A'.repeat(20), maxSize: 10, minSize: 5, maxWidth: 64, measure });
    expect(shrunk.fits).toBe(true);
    if (shrunk.fits) {
      expect(shrunk.fontSize).toBeGreaterThanOrEqual(5);
      expect(shrunk.fontSize).toBeLessThan(10);
      expect(shrunk.textWidth).toBeLessThanOrEqual(64 + EPS);
    }
    // 40 chars: even @5pt = 120 > 64 -> no fit
    const nofit = fitThermalCaptionFontSize({ text: 'A'.repeat(40), maxSize: 10, minSize: 5, maxWidth: 64, measure });
    expect(nofit.fits).toBe(false);
  });

  it('computeCenteredCaptionX / computeThermalCaptionBaselineY — pure arithmetic', () => {
    expect(computeCenteredCaptionX(144, 50)).toBe(119);
    expect(computeCenteredCaptionX(36, 64)).toBe(4);
    expect(computeThermalCaptionBaselineY(168.8, 6, 7.18)).toBeCloseTo(155.62, 6);
    expect(computeThermalCaptionBaselineY(57.2, 6, 5.4)).toBeCloseTo(45.8, 6);
  });
});

describe('computeWarehouseLabelSheetLayout — A4 tiled controls (unchanged)', () => {
  it('TG7 — avery-5160 stays A4, 24/sheet, all content inside the page', () => {
    const layout = computeWarehouseLabelSheetLayout('avery-5160', 24);
    expect(layout.page).toEqual({ width: 595.28, height: 841.89 });
    expect(layout.perPage).toBe(24);
    expect(layout.pageCount).toBe(1);
    for (const idx of [0, 23]) {
      const slot = layout.slots[idx];
      expectRectInsidePage(slot.frame, layout, `avery-5160 frame ${idx}`);
      expectRectInsidePage(slot.barcode, layout, `avery-5160 barcode ${idx}`);
      if (slot.caption.mode !== 'fixed') throw new Error('expected fixed caption');
      expect(slot.caption.y).toBeGreaterThanOrEqual(0);
    }
    const bc0 = layout.slots[0].barcode;
    expect(bc0.x).toBeCloseTo(8 * 2.8346 + 4, 6);
    expect(bc0.width).toBeCloseTo(66 * 2.8346 - 8, 6);
    expect(bc0.height).toBeCloseTo(25 * 2.8346 * 0.6, 6);
    expect(bc0.y).toBeCloseTo(841.89 - 8 * 2.8346 - (25 * 2.8346 + 2 * 2.8346) + 25 * 2.8346 - 25 * 2.8346 * 0.6 - 4, 6);
    const cap0 = layout.slots[0].caption;
    if (cap0.mode !== 'fixed') throw new Error('expected fixed caption');
    expect(cap0.y).toBeCloseTo(841.89 - 8 * 2.8346 - (25 * 2.8346 + 2 * 2.8346) + 6, 6);
  });

  it('TG9 — existing 30-location avery-5160 pagination stays at exactly 2 pages', () => {
    const layout = computeWarehouseLabelSheetLayout('avery-5160', 30);
    expect(layout.pageCount).toBe(2);
    expect(layout.slots).toHaveLength(30);
    expect(layout.slots[23].pageIndex).toBe(0);
    expect(layout.slots[24].pageIndex).toBe(1);
  });

  it('TG8 — avery-5163 stays A4 / 2-col / 10-per-sheet; pre-existing right-column bleed is <= 2pt', () => {
    const layout = computeWarehouseLabelSheetLayout('avery-5163', 10);
    expect(layout.page).toEqual({ width: 595.28, height: 841.89 });
    expect(layout.perPage).toBe(10);
    expect(layout.pageCount).toBe(1);

    // Pre-existing, production-accepted right-column bleed. A4-tiled-only tolerance;
    // Zebra/Dymo require zero overflow (TG2/TG6).
    const last = layout.slots[9];
    const overflowPt = last.barcode.x + last.barcode.width - layout.page.width;
    expect(overflowPt).toBeGreaterThan(0);
    expect(overflowPt).toBeLessThanOrEqual(2);
    expect(last.frame.y).toBeGreaterThanOrEqual(0);
    if (last.caption.mode !== 'fixed') throw new Error('expected fixed caption');
    expect(last.caption.y).toBeGreaterThanOrEqual(0);
  });
});

describe('computeWarehouseLabelSheetLayout — value boundary (TG10 / CC11)', () => {
  it('is pure geometry: identical output for the same (formatId, count), no barcode/tenant content', () => {
    const a = computeWarehouseLabelSheetLayout('zebra-4x6', 3);
    const b = computeWarehouseLabelSheetLayout('zebra-4x6', 3);
    expect(a).toEqual(b); // deterministic — no time/random/IO

    // The layout carries geometry + format identity + the caption discriminant
    // only; no zone.barcode, no location_code, no tenant/shop data. The renderer
    // still resolves the Code128 value via `zone.barcode ?? zone.location_code`
    // and generateCode128Png, both untouched by this fix.
    expect(Object.keys(a.slots[0])).toEqual(['pageIndex', 'frame', 'barcode', 'caption']);
    const strings = collectStrings(a);
    expect(strings.sort()).toEqual(['4x6', 'thermal-centered', 'thermal-centered', 'thermal-centered', 'zebra-4x6']);
  });

  it('unknown formatId falls back to avery-5160 (unchanged behaviour)', () => {
    const layout = computeWarehouseLabelSheetLayout('no-such-format', 1);
    expect(layout.page).toEqual({ width: 595.28, height: 841.89 });
    expect(layout.perPage).toBe(24);
  });
});
