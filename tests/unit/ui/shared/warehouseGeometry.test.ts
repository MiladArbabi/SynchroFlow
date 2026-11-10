import { floorObjects, projectWarehouseRoot, DEFAULT_COMPONENT_FOOTPRINT } from '../../../../modules/shared/src/ui/warehouseGeometry';
import { componentFootprintEdge } from '../../../../modules/floor-planning/src/ui/components/warehouseBoundary';
import { hasOperationalFloor } from '../../../../apps/frontend/src/pages/floor-planning/operationalFloor';

const root = { location_code: 'ROOT', parent_location_code: null, type: 'warehouse' as const,
  position_x: null, position_y: null, width: 10, depth: 8 };
const rack = { ...root, location_code: 'RACK', parent_location_code: 'ROOT', type: 'bin' as const, position_x: 2, position_y: 3 };

it('preserves explicit origins and leaves ordinary unpositioned or partially positioned geometry untouched', () => {
  const explicit = { ...root, position_x: 4, position_y: 5 };
  const unplaced = { ...rack, position_x: null, position_y: null };
  const partial = { ...rack, position_y: null };
  expect(projectWarehouseRoot(explicit)).toBe(explicit);
  expect(projectWarehouseRoot(unplaced)).toBe(unplaced);
  expect(projectWarehouseRoot(partial)).toBe(partial);
  expect(projectWarehouseRoot({ ...root, width: null }).position_x).toBeNull();
});

it('uses the canonical fallback for both 2D footprint edges without filling stored dimensions', () => {
  const legacy = Object.freeze({ ...rack, width: null, depth: null });
  expect(DEFAULT_COMPONENT_FOOTPRINT).toEqual({ width: 1, depth: 0.8 });
  expect(componentFootprintEdge(legacy, 'width')).toBe(3);
  expect(componentFootprintEdge(legacy, 'depth')).toBe(3.8);
  expect(legacy.depth).toBeNull();
});

it('uses only parent links, keeping lane children and orphans as floor objects', () => {
  const lane = { ...rack, location_code: 'AISLE', type: 'lane' };
  const child = { ...rack, location_code: 'CHILD', parent_location_code: 'RACK' };
  const laneChild = { ...rack, location_code: 'LANE-CHILD', parent_location_code: 'AISLE' };
  const orphan = { ...rack, location_code: 'ORPHAN', parent_location_code: 'MISSING' };
  const records = Object.freeze([Object.freeze(root), Object.freeze(rack), lane, child, laneChild, orphan]);
  expect(floorObjects(records).map(z => z.location_code)).toEqual(['ROOT', 'RACK', 'AISLE', 'LANE-CHILD', 'ORPHAN']);
  expect(records).toHaveLength(6);
});

it('does not treat positioned nested identities as an operational floor across screen readiness checks', () => {
  const parent = { ...rack, position_x: null, position_y: null };
  const child = { ...rack, location_code: 'CHILD', parent_location_code: 'RACK' };
  expect(hasOperationalFloor([root, parent, child])).toBe(false);
  expect(hasOperationalFloor([root, rack, child])).toBe(true);
});
