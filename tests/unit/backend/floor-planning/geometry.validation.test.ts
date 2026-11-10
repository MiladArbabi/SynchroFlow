import { validateGeometry, translatedCoordinates } from '../../../../apps/backend/src/api/floor-planning/geometry.validation';

describe('Floor Planning authoritative geometry', () => {
  it.each(['2', true, {}, NaN, Infinity, -Infinity, -0.001, 100000, 1.0001, 1e-7])('rejects invalid coordinate %p', value => {
    expect(() => validateGeometry({ position_x: value, position_y: 1 })).toThrow();
  });
  it.each(['1', false, NaN, Infinity, 0, -1, 1000, 0.0001])('rejects invalid dimensions %p', value => {
    for (const field of ['width', 'depth']) expect(() => validateGeometry({ [field]: value })).toThrow();
  });
  it.each(['1', true, 0, 21, 1.5, NaN, Infinity])('rejects malformed levels %p', rack_levels => {
    expect(() => validateGeometry({ rack_levels })).toThrow();
  });
  it.each([null, '90', 45, 360, NaN])('rejects explicit orientation %p', orientation => {
    expect(() => validateGeometry({ orientation })).toThrow();
  });
  it('accepts endpoints, null sizes and valid discrete values', () => {
    for (const orientation of [0, 90, 180, 270]) {
      validateGeometry({ position_x: 0, position_y: 99999.999, width: 0.001, depth: 999.999, orientation, rack_levels: 20 });
    }
    validateGeometry({ position_x: null, position_y: null, width: null, depth: null, rack_levels: null });
    validateGeometry({ width: 1.001, rack_levels: 1 });
  });
  it('validates the resulting PATCH pair, including persisted numeric strings', () => {
    validateGeometry({ position_x: 2 }, { position_x: '1.000', position_y: '3.000' });
    validateGeometry({ position_x: 2 }, { position_x: null, position_y: '3.000' });
    expect(() => validateGeometry({ position_x: 2 })).toThrow(/both/);
    expect(() => validateGeometry({ position_x: null }, { position_y: '3.000' })).toThrow(/both/);
    expect(() => validateGeometry({ position_x: 2 }, { position_y: '-1' })).toThrow();
  });
  it('leaves untouched historic geometry and omitted fields unchanged', () => {
    const historic = { position_x: '-1', position_y: null, width: null, depth: null, orientation: 45, rack_levels: 30 };
    const before = { ...historic };
    validateGeometry({ active: false }, historic);
    validateGeometry({ width: 2 }, historic);
    expect(historic).toEqual(before);
  });
  it('validates translated results and avoids decimal addition noise', () => {
    expect(translatedCoordinates({ position_x: '0.1', position_y: '1.001' }, { x: 0.2, y: -0.001 }))
      .toEqual({ position_x: 0.3, position_y: 1 });
    for (const offset of [{ x: -2, y: 0 }, { x: 99999.999, y: 0 }, { x: 0.0001, y: 0 }]) {
      expect(() => translatedCoordinates({ position_x: '1', position_y: '1' }, offset)).toThrow();
    }
    expect(() => translatedCoordinates({ position_x: 1, position_y: null }, { x: 1, y: 1 })).toThrow(/both/);
    expect(translatedCoordinates({ position_x: null, position_y: null, width: null, depth: null }, { x: 1, y: 1 }))
      .toEqual({ position_x: null, position_y: null });
  });
});

import {
  warehouseBounds, boundaryOverflow, worsensBoundary, componentsNewlyExcluded, isNestedAddress,
  NULL_SIZE_COMPONENT_FOOTPRINT,
} from '../../../../apps/backend/src/api/floor-planning/geometry.validation';

/** FP-SPATIAL-S2B — warehouse boundary containment rules (pure). */
describe('FP-SPATIAL-S2B warehouse boundary containment', () => {
  const root = { position_x: 0, position_y: 0, width: 10, depth: 8 };
  const bounds = warehouseBounds(root)!;
  const at = (x: number | null, y: number | null, extra: Record<string, unknown> = {}) => ({
    location_code: 'C', type: 'bin', position_x: x, position_y: y, width: 2, depth: 1, parent_type: null, ...extra,
  });

  it('derives the boundary, the implicit (0,0) origin, and no boundary without usable dimensions', () => {
    expect(bounds).toEqual({ x: 0, y: 0, width: 10, depth: 8 });
    expect(warehouseBounds({ position_x: null, position_y: null, width: 10, depth: 8 })).toEqual({ x: 0, y: 0, width: 10, depth: 8 });
    expect(warehouseBounds({ position_x: '3', position_y: '4', width: '10', depth: '8' })).toEqual({ x: 3, y: 4, width: 10, depth: 8 });
    for (const dims of [{ width: null, depth: 8 }, { width: 10, depth: null }, { width: 0, depth: 8 }, { width: -1, depth: 8 }]) {
      expect(warehouseBounds({ position_x: 0, position_y: 0, ...dims })).toBeNull();
    }
  });

  it('checks the complete footprint on all four edges, inclusive of exact edges', () => {
    expect(boundaryOverflow(at(0, 0), bounds)).toBe(0);
    expect(boundaryOverflow(at(8, 7), bounds)).toBe(0);          // touches right & bottom exactly
    expect(boundaryOverflow(at(-0.5, 2), bounds)).toBeCloseTo(0.5); // left
    expect(boundaryOverflow(at(2, -0.25), bounds)).toBeCloseTo(0.25); // top
    expect(boundaryOverflow(at(8.5, 2), bounds)).toBeCloseTo(0.5); // right
    expect(boundaryOverflow(at(2, 7.5), bounds)).toBeCloseTo(0.5); // bottom
    const offsetBounds = warehouseBounds({ position_x: 5, position_y: 5, width: 10, depth: 8 })!;
    expect(boundaryOverflow(at(4, 6), offsetBounds)).toBeCloseTo(1); // left of a moved root
  });

  it('uses the display-only 1 x 0.8 m footprint for null sizes without mutating the record', () => {
    const nullSized = at(9.2, 7.3, { width: null, depth: null });
    expect(NULL_SIZE_COMPONENT_FOOTPRINT).toEqual({ width: 1, depth: 0.8 });
    expect(boundaryOverflow(nullSized, bounds)).toBeCloseTo(0.2 + 0.1);
    expect(nullSized).toMatchObject({ width: null, depth: null });
    expect(boundaryOverflow(at(9, 7.2, { width: null, depth: null }), bounds)).toBe(0);
  });

  it('never evaluates roots, unpositioned rows, nested bin addresses, or boundary-less warehouses', () => {
    expect(boundaryOverflow(at(50, 50, { type: 'warehouse' }), bounds)).toBe(0);
    expect(boundaryOverflow(at(null, null), bounds)).toBe(0);
    expect(boundaryOverflow(at(50, 50, { parent_type: 'shelf' }), bounds)).toBe(0);
    expect(boundaryOverflow(at(50, 50, { parent_type: 'bin' }), bounds)).toBe(0);
    expect(isNestedAddress({ type: 'bin', parent_type: 'lane' })).toBe(false);
    expect(isNestedAddress({ type: 'shelf', parent_type: 'shelf' })).toBe(false);
    expect(boundaryOverflow(at(50, 50, { parent_type: 'lane' }), bounds)).toBeGreaterThan(0);
    expect(boundaryOverflow(at(50, 50), null)).toBe(0);
  });

  it('component writes may not worsen overflow; legacy rows stay correctable', () => {
    expect(worsensBoundary(null, at(1, 1), bounds)).toBe(false);
    expect(worsensBoundary(null, at(9, 1), bounds)).toBe(true);               // new, outside
    expect(worsensBoundary(at(1, 1), at(-1, 1), bounds)).toBe(true);          // inside -> outside
    const legacy = at(12, 1);                                                // 4 m outside
    expect(worsensBoundary(legacy, at(8, 11), bounds)).toBe(true); // equal total, new bottom violation
    expect(worsensBoundary(legacy, at(11, 8), bounds)).toBe(true); // lower total, new bottom violation
    expect(worsensBoundary(legacy, legacy, bounds)).toBe(false);             // unrelated edit
    expect(worsensBoundary(legacy, at(10, 1), bounds)).toBe(false);          // partial correction
    expect(worsensBoundary(legacy, at(1, 1), bounds)).toBe(false);           // full correction
    expect(worsensBoundary(legacy, at(13, 1), bounds)).toBe(true);           // worse
    expect(worsensBoundary(legacy, { ...legacy, width: 3 }, bounds)).toBe(true); // resize worse
    expect(worsensBoundary(at(1, 1), at(null, null), bounds)).toBe(false);   // unplacing
    expect(worsensBoundary(at(9, 1), at(50, 50), null)).toBe(false);         // no boundary
  });

  it('root writes reject every worsened edge, including legacy rows; growth remains valid', () => {
    const inside = at(7, 1, { location_code: 'IN' });
    const legacy = at(20, 1, { location_code: 'LEGACY' });
    const nested = at(9.5, 1, { location_code: 'NESTED', parent_type: 'shelf' });
    const all = [inside, legacy, nested];
    const next = (geometry: Record<string, unknown>) => warehouseBounds({ ...root, ...geometry });
    expect(componentsNewlyExcluded(bounds, next({ width: 8 }), all)).toEqual(['IN', 'LEGACY']);         // shrink clips right edge
    expect(componentsNewlyExcluded(bounds, next({ position_x: 7.5 }), all)).toEqual(['IN']);  // move clips left edge (7 < 7.5)
    expect(componentsNewlyExcluded(bounds, next({ position_x: 0.5 }), all)).toEqual([]);         // small move keeps IN (7..9 within 0.5..10.5)
    expect(componentsNewlyExcluded(bounds, next({ position_y: -1 }), all)).toEqual([]);       // move keeps IN inside (y 1..2 within -1..7)
    expect(componentsNewlyExcluded(bounds, next({ position_y: 1.5 }), all)).toEqual(['IN', 'LEGACY']);  // move clips top edge
    expect(componentsNewlyExcluded(bounds, next({ width: 30, depth: 20 }), all)).toEqual([]); // growth
    expect(componentsNewlyExcluded(null, next({ width: 8 }), all)).toEqual(['IN', 'LEGACY']); // first boundary (GH-1176)
    expect(componentsNewlyExcluded(bounds, null, all)).toEqual([]);                           // dimensions removed
  });
});

// Improvement on one edge never pays for worsening another, for either writer.
describe('S2B independent edges', () => {
  const bounds = { x: 5, y: 5, width: 10, depth: 8 };
  const location = { location_code: 'LEGACY', type: 'bin', position_x: 4, position_y: 4, width: 12, depth: 10 };
  it.each([
    { position_x: 3, width: 12 }, { position_y: 3, depth: 10 },
    { position_x: 5, width: 12 }, { position_y: 5, depth: 10 },
  ])('rejects component changes that increase one edge: %p', change => {
    expect(worsensBoundary(location, { ...location, ...change }, bounds)).toBe(true);
  });
  it.each([
    { x: 6 }, { y: 6 }, { width: 9 }, { depth: 7 },
  ])('rejects root changes worsening legacy violations: %p', change => {
    expect(componentsNewlyExcluded(bounds, { ...bounds, ...change }, [location])).toEqual(['LEGACY']);
  });
});
