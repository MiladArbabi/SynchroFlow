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
