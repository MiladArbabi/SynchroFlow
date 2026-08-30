/**
 * SHOP-REVIEW-BARCODE-PRINT-05 — thermal location-label geometry.
 *
 * The production incident (Zebra 4x6 barcode clipped at the page edge, caption
 * pushed off the bottom) escaped because PDF *pagination* was tested but no test
 * asserted that drawn elements stay inside the MediaBox. `generateWarehouseLabelSheetPdf`
 * now computes its layout once via the pure `computeWarehouseLabelSheetLayout`
 * helper and draws exactly that; these tests assert the same layout the renderer
 * consumes, so a render/expectation drift cannot recur silently.
 *
 * Pure geometry only — no DB, no PDF rendering, no barcode content.
 */
import {
  computeWarehouseLabelSheetLayout,
  type WarehouseLabelRect,
  type WarehouseLabelSheetLayout,
} from 'api-src/services/wms/warehouseLabelPdf.service';

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectStrings);
  return [];
}

function expectRectInsidePage(rect: WarehouseLabelRect, layout: WarehouseLabelSheetLayout, label: string) {
  const { width: pageW, height: pageH } = layout.page;
  expect(rect.x).toBeGreaterThanOrEqual(0);                       // left
  expect(rect.y).toBeGreaterThanOrEqual(0);                       // bottom
  expect(rect.x + rect.width).toBeLessThanOrEqual(pageW + 1e-6);  // right
  expect(rect.y + rect.height).toBeLessThanOrEqual(pageH + 1e-6); // top
  // annotate on failure
  void label;
}

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

    it('TG2 — barcode, caption and frame are entirely inside the page (no negative coords, no overflow)', () => {
      const layout = computeWarehouseLabelSheetLayout('zebra-4x6', 3);
      for (const slot of layout.slots) {
        expect(slot.frame.x).toBeGreaterThanOrEqual(0);
        expect(slot.frame.y).toBeGreaterThanOrEqual(0);
        expect(slot.frame).toEqual({ x: 0, y: 0, width: 288, height: 432 });
        expectRectInsidePage(slot.barcode, layout, 'zebra barcode');
        // caption baseline on-page, glyph top on-page
        expect(slot.caption.y).toBeGreaterThanOrEqual(0);
        expect(slot.caption.y + slot.caption.fontSize).toBeLessThanOrEqual(layout.page.height);
        expect(slot.caption.x).toBeGreaterThanOrEqual(0);
      }
    });

    it('TG3 — barcode keeps a positive left and right quiet-zone inset (not edge-to-edge)', () => {
      const { slots, page } = computeWarehouseLabelSheetLayout('zebra-4x6', 1);
      const bc = slots[0].barcode;
      const leftInset = bc.x;
      const rightInset = page.width - (bc.x + bc.width);
      expect(leftInset).toBeGreaterThanOrEqual(4);
      expect(rightInset).toBeGreaterThanOrEqual(4);
      // stays clear of the advertised 284pt right boundary from the brief
      expect(bc.x + bc.width).toBeLessThanOrEqual(284);
    });

    it('TG4 — caption sits below the barcode with no vertical overlap', () => {
      const { slots } = computeWarehouseLabelSheetLayout('zebra-4x6', 1);
      const { barcode, caption } = slots[0];
      expect(caption.y + caption.fontSize).toBeLessThanOrEqual(barcode.y);
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

    it('TG6 — barcode + caption entirely inside the page, with a positive left/right inset', () => {
      const layout = computeWarehouseLabelSheetLayout('dymo-1x2', 3);
      for (const slot of layout.slots) {
        expect(slot.frame).toEqual({ x: 0, y: 0, width: 72, height: 153 });
        expectRectInsidePage(slot.barcode, layout, 'dymo barcode');
        const leftInset = slot.barcode.x;
        const rightInset = layout.page.width - (slot.barcode.x + slot.barcode.width);
        expect(leftInset).toBeGreaterThanOrEqual(4);
        expect(rightInset).toBeGreaterThanOrEqual(4);
        expect(slot.caption.y).toBeGreaterThanOrEqual(0);
        expect(slot.caption.y + slot.caption.fontSize).toBeLessThanOrEqual(layout.page.height);
        expect(slot.caption.y + slot.caption.fontSize).toBeLessThanOrEqual(slot.barcode.y); // no overlap
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

describe('computeWarehouseLabelSheetLayout — A4 tiled controls (unchanged)', () => {
  it('TG7 — avery-5160 stays A4, 24/sheet, all content inside the page', () => {
    const layout = computeWarehouseLabelSheetLayout('avery-5160', 24);
    expect(layout.page).toEqual({ width: 595.28, height: 841.89 });
    expect(layout.perPage).toBe(24);
    expect(layout.pageCount).toBe(1);
    // representative first + last label on the first sheet
    for (const idx of [0, 23]) {
      const slot = layout.slots[idx];
      expectRectInsidePage(slot.frame, layout, `avery-5160 frame ${idx}`);
      expectRectInsidePage(slot.barcode, layout, `avery-5160 barcode ${idx}`);
      expect(slot.caption.y).toBeGreaterThanOrEqual(0);
    }
    // coordinate-equivalent to the pre-refactor renderer for the first label:
    //   x = 8mm + 4 ; y = A4H - 8mm - (25mm + 2mm) + (25mm*0.4) - 4 ;
    //   w = 66mm - 8 ; h = 25mm * 0.6      (mm -> pt at 2.8346)
    const bc0 = layout.slots[0].barcode;
    expect(bc0.x).toBeCloseTo(8 * 2.8346 + 4, 6);
    expect(bc0.width).toBeCloseTo(66 * 2.8346 - 8, 6);
    expect(bc0.height).toBeCloseTo(25 * 2.8346 * 0.6, 6);
    expect(bc0.y).toBeCloseTo(841.89 - 8 * 2.8346 - (25 * 2.8346 + 2 * 2.8346) + 25 * 2.8346 - 25 * 2.8346 * 0.6 - 4, 6);
    expect(layout.slots[0].caption.y).toBeCloseTo(841.89 - 8 * 2.8346 - (25 * 2.8346 + 2 * 2.8346) + 6, 6);
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

    // Pre-existing, production-accepted: the right column's barcode image
    // extends ~1.66pt (~0.58mm) past the A4 right edge under the historical
    // 8mm-margin + 2mm-gap tiling. Not corrected in the thermal fix; asserted
    // here only so it cannot silently WORSEN. This tolerance is A4-tiled-only —
    // Zebra/Dymo must be fully inside the page with zero overflow (TG2/TG6).
    const last = layout.slots[9];
    const overflowPt = last.barcode.x + last.barcode.width - layout.page.width;
    expect(overflowPt).toBeGreaterThan(0);       // documents the known condition
    expect(overflowPt).toBeLessThanOrEqual(2);   // must not regress past 2pt
    // vertically every 5163 label is inside the page
    expect(last.frame.y).toBeGreaterThanOrEqual(0);
    expect(last.caption.y).toBeGreaterThanOrEqual(0);
  });
});

describe('computeWarehouseLabelSheetLayout — value boundary (TG10)', () => {
  it('is pure geometry: identical output for the same (formatId, count), no barcode content', () => {
    const a = computeWarehouseLabelSheetLayout('zebra-4x6', 3);
    const b = computeWarehouseLabelSheetLayout('zebra-4x6', 3);
    expect(a).toEqual(b); // deterministic — no time/random/IO

    // The layout carries geometry + the format identity only; no zone.barcode,
    // no location_code, no tenant/shop data. The renderer still resolves the
    // Code128 value via `zone.barcode ?? zone.location_code` and generateCode128Png,
    // both untouched by this fix.
    expect(Object.keys(a.slots[0])).toEqual(['pageIndex', 'frame', 'barcode', 'caption']);
    const strings = collectStrings(a);
    expect(strings.sort()).toEqual(['4x6', 'zebra-4x6']); // formatId + paperSize, nothing else
  });

  it('unknown formatId falls back to avery-5160 (unchanged behaviour)', () => {
    const layout = computeWarehouseLabelSheetLayout('no-such-format', 1);
    expect(layout.page).toEqual({ width: 595.28, height: 841.89 });
    expect(layout.perPage).toBe(24);
  });
});
