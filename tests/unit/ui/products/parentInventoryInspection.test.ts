import { parentInventoryInspection } from '../../../../apps/frontend/src/pages/floor-planning/parentInventoryInspection';
import type { WarehouseZone, LocationStockDetail } from '@lasyncro/shared/ui';

const zone = (code: string, parent: string | null) => ({ location_code: code, parent_location_code: parent }) as WarehouseZone;
const stock = (on_hand_quantity: number, available_quantity = on_hand_quantity, reserved_quantity = 0): LocationStockDetail => ({
  on_hand_quantity, available_quantity, reserved_quantity,
  variants: [{ lasyncro_variant_id: 'v1', sku: 'SKU-1', product_title: null, variant_title: null, on_hand_quantity, available_quantity, reserved_quantity }],
});

it('sums direct legacy stock and nested descendants exactly once, preserving signed reservations and SKU detail', () => {
  const zones = [zone('R', null), zone('S', 'R'), zone('B1', 'S'), zone('B2', 'R'), zone('B2', 'R'), zone('OTHER', null)];
  const inspection = { R: stock(5, 3, 2), S: stock(0), B1: stock(-3, -4, 1), B2: stock(8, 5, 3), OTHER: stock(100) };
  const before = JSON.stringify(inspection);
  const result = parentInventoryInspection('R', zones, inspection);
  expect(result.total).toMatchObject({ on_hand_quantity: 10, available_quantity: 4, reserved_quantity: 6 });
  expect(result.total.variants).toEqual([expect.objectContaining({ lasyncro_variant_id: 'v1', on_hand_quantity: 10, available_quantity: 4, reserved_quantity: 6 })]);
  expect(result.locations).toHaveLength(4);
  expect(result.locations.find(location => location.code === 'B1')?.detail?.variants[0].on_hand_quantity).toBe(-3);
  expect(result.locations.filter(location => location.direct).map(location => location.code)).toEqual(['R']);
  expect(result.unknownLocations).toBe(0);
  expect(JSON.stringify(inspection)).toBe(before);
});

it('distinguishes missing parents, intermediate shelves and bins from confirmed zero', () => {
  const zones = [zone('R', null), zone('S', 'R'), zone('B', 'S')];
  expect(parentInventoryInspection('R', zones, { B: stock(0) }).unknownLocations).toBe(2);
  expect(parentInventoryInspection('R', zones, { R: stock(0), S: stock(0), B: stock(0) })).toMatchObject({ unknownLocations: 0, total: { on_hand_quantity: 0 } });
  expect(parentInventoryInspection('R', zones).unknownLocations).toBe(3);
});

it('terminates cyclic ancestry without duplicating exact records', () => {
  const result = parentInventoryInspection('R', [zone('R', 'S'), zone('S', 'R')], { R: stock(2), S: stock(3) });
  expect(result.total.on_hand_quantity).toBe(5);
  expect(result.locations).toHaveLength(2);
});


it('keeps distinct SKUs separate while consolidating the same variant across locations', () => {
  const direct = stock(3);
  const child = stock(2);
  child.variants.push({ ...child.variants[0], lasyncro_variant_id: 'v2', sku: 'SKU-2', on_hand_quantity: -1, available_quantity: -2, reserved_quantity: 1 });
  child.on_hand_quantity = 1;
  child.available_quantity = 0;
  child.reserved_quantity = 1;
  const result = parentInventoryInspection('R', [zone('R', null), zone('B', 'R')], { R: direct, B: child });
  expect(result.total.variants).toEqual([
    expect.objectContaining({ lasyncro_variant_id: 'v1', on_hand_quantity: 5, available_quantity: 5, reserved_quantity: 0 }),
    expect.objectContaining({ lasyncro_variant_id: 'v2', on_hand_quantity: -1, available_quantity: -2, reserved_quantity: 1 }),
  ]);
  for (const quantity of ['on_hand_quantity', 'available_quantity', 'reserved_quantity'] as const) {
    expect(result.total.variants.reduce((sum, variant) => sum + variant[quantity], 0)).toBe(result.total[quantity]);
  }
});
