import { componentsNewlyExcluded, warehouseBounds } from '../../../../apps/backend/src/api/floor-planning/geometry.validation';
import { componentsExcludedByResize, geometryErrorMessage, parseGeometryInput } from '../../../../modules/floor-planning/src/ui/components/warehouseBoundary';
const root = { type: 'warehouse', position_x: null, position_y: null, width: 10, depth: 8 };
const child = { location_code: 'LEGACY', type: 'bin', position_x: 12, position_y: 1, width: 2, depth: 1 };
it('matches legacy non-worsening, growth and first-boundary behavior with an implicit origin', () => {
  expect(componentsExcludedByResize(root, { width: 9 }, [child])).toEqual([child]);
  expect(componentsExcludedByResize(root, { width: 11 }, [child])).toEqual([]);
  expect(componentsExcludedByResize(root, { width: 10 }, [child])).toEqual([]);
  expect(componentsExcludedByResize({ ...root, depth: null }, { width: 9 }, [child])).toEqual([]);
  expect(componentsExcludedByResize({ ...root, depth: null }, { width: 9, depth: 8 }, [child])).toEqual([child]);
});
it('uses the display footprint for null sizes and excludes unpositioned rows', () => {
  const edge = { ...child, position_x: 9, width: null, depth: null };
  expect(componentsExcludedByResize(root, { width: 9.5 }, [edge])).toEqual([edge]);
  expect(edge.width).toBeNull();
  expect(componentsExcludedByResize(root, { width: 1 }, [{ ...child, position_x: null }])).toEqual([]);
});
it('parses complete decimal and integer strings without mutating blank input', () => {
  expect(parseGeometryInput('', 'width')).toEqual({});
  expect(parseGeometryInput('0', 'position_x')).toEqual({ value: 0 });
  expect(parseGeometryInput('0.001', 'width')).toEqual({ value: 0.001 });
  expect(parseGeometryInput('999.999', 'width')).toEqual({ value: 999.999 });
  expect(parseGeometryInput('99999.999', 'position_y')).toEqual({ value: 99999.999 });
  for (const value of ['2junk', '1e1', 'NaN', 'Infinity', '-1', '1.0001']) expect(parseGeometryInput(value, 'width').error).toBeTruthy();
  for (const value of ['1.5', '0', '21', '1e1']) expect(parseGeometryInput(value, 'rack_levels').error).toBeTruthy();
  expect(parseGeometryInput('20', 'rack_levels')).toEqual({ value: 20 });
});
it('preserves validation messages/codes but uses safe fallback for other failures', () => {
  expect(geometryErrorMessage({ response: { status: 400, data: { error: 'width must be positive' } } })).toBe('width must be positive');
  expect(geometryErrorMessage({ response: { status: 422, data: { message: 'Outside', location_codes: ['A', 'B'] } } })).toContain('A, B');
  expect(geometryErrorMessage({ response: { status: 500, data: { error: 'private server details' } } }, 'Retry')).toBe('Retry');
});


it('checks all four edges of a first 10×8 boundary at (5,5), matching S2B', () => {
  const first = { ...root, position_x: 5, position_y: 5, width: null, depth: null };
  const next = { width: 10, depth: 8 };
  const locations = [
    { ...child, location_code: 'LEFT', position_x: 4, position_y: 6, width: 1, depth: 1 },
    { ...child, location_code: 'TOP', position_x: 6, position_y: 4, width: 1, depth: 1 },
    { ...child, location_code: 'RIGHT', position_x: 14.5, position_y: 6, width: 1, depth: 1 },
    { ...child, location_code: 'BOTTOM', position_x: 6, position_y: 12.5, width: 1, depth: 1 },
    { ...child, location_code: 'NEAR-EDGE', position_x: 5, position_y: 5, width: 1, depth: 1 },
    { ...child, location_code: 'FAR-EDGE', position_x: 14, position_y: 12, width: 1, depth: 1 },
  ];
  const excluded = componentsExcludedByResize(first, next, locations).map(row => row.location_code);
  expect(excluded).toEqual(['LEFT', 'TOP', 'RIGHT', 'BOTTOM']);
  expect(excluded).toEqual(componentsNewlyExcluded(warehouseBounds(first), warehouseBounds({ ...first, ...next }), locations));
  // Once those near-edge violations are legacy, unchanged near edges do not
  // block a resize that preserves them. Far-edge increases still reject.
  const existing = { ...first, ...next };
  const smaller = { width: 9, depth: 7 };
  const legacy = [locations[0], locations[1], { ...locations[2], position_x: 17 }];
  const worsened = componentsExcludedByResize(existing, smaller, legacy).map(row => row.location_code);
  expect(worsened).toEqual(['RIGHT']);
  expect(worsened).toEqual(componentsNewlyExcluded(warehouseBounds(existing), warehouseBounds({ ...existing, ...smaller }), legacy));
});
