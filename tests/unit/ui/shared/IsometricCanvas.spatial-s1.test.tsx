import { render, screen } from '@testing-library/react';
import { IsometricCanvas, IsometricZoneView, type WarehouseZone } from '@lasyncro/shared/ui';

const zone = (location_code: string, fields: Partial<WarehouseZone> = {}): WarehouseZone => ({
  location_code, type: 'bin', parent_location_code: null, barcode: null, active: true,
  children_count: 0, position_x: 1, position_y: 1, width: 1, depth: 0.8,
  orientation: 0, rack_levels: 2, zone_type: 'pick', last_printed_at: null,
  warehouse_name: null, ...fields,
});
const polygons = (container: HTMLElement) => Array.from(container.querySelectorAll('polygon')).map(p => p.getAttribute('points'));

it('uses the same 1 x 0.8 display footprint for legacy null sizes in canvas and detail views', () => {
  const legacy = zone('RACK', { width: null, depth: null });
  const explicit = zone('RACK');
  const { container, rerender } = render(<IsometricCanvas zones={[legacy]} />);
  const before = polygons(container);
  rerender(<IsometricCanvas zones={[explicit]} />);
  expect(polygons(container)).toEqual(before);
  rerender(<IsometricZoneView zone={legacy} />);
  const detail = polygons(container);
  rerender(<IsometricZoneView zone={explicit} />);
  expect(polygons(container)).toEqual(detail);
  expect(legacy.width).toBeNull();
  expect(legacy.depth).toBeNull();
});

it('projects an implicit root exactly like an explicit origin without rewriting data', () => {
  const root = zone('ROOT', { type: 'warehouse', width: 10, depth: 8, position_x: null, position_y: null });
  const { container, rerender } = render(<IsometricCanvas zones={[root, zone('RACK')]} />);
  const implicit = polygons(container);
  rerender(<IsometricCanvas zones={[{ ...root, position_x: 0, position_y: 0 }, zone('RACK')]} />);
  expect(polygons(container)).toEqual(implicit);
  expect(root.position_x).toBeNull();
  expect(root.position_y).toBeNull();
});

it.each(['Overview', 'Orders', 'Inventory', 'Floor Planning'])('%s presentation keeps nested identities off the floor and genuine unplaced objects visible', (screenName) => {
  const zones = [zone('RACK'), zone('SHELF', { type: 'shelf' }),
    zone('CHILD', { parent_location_code: 'RACK', position_x: null, position_y: null }),
    zone('LEGACY-CHILD', { parent_location_code: 'SHELF', position_x: 4 }),
    zone('UNPLACED', { position_y: null }),
    zone('ORPHAN', { parent_location_code: 'UNKNOWN', position_x: 7 })];
  const original = JSON.stringify(zones);
  render(<IsometricCanvas zones={zones} occupancy={screenName === 'Inventory' ? { RACK: { on_hand_quantity: 2 } } : undefined}
    occupancyPresentation={screenName === 'Overview' ? 'neutral' : undefined} />);
  expect(screen.getByText('1 location not placed on the floor')).toBeVisible();
  expect(screen.queryByText('LEGACY-CHILD', { selector: 'text' })).not.toBeInTheDocument();
  expect(screen.getByText('ORPHAN', { selector: 'text' })).toBeInTheDocument();
  expect(JSON.stringify(zones)).toBe(original);
});
