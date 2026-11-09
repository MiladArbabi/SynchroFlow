import { fireEvent, render, screen } from '@testing-library/react';
import FloorPlanningModuleFT2 from '../../../../modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2';
import type { WarehouseZone, LocationStockDetail } from '@lasyncro/shared/ui';

jest.mock('jsbarcode', () => ({ __esModule: true, default: jest.fn() }));

const zone = (location_code: string, overrides: Partial<WarehouseZone> = {}): WarehouseZone => ({
  location_code, type: 'bin', parent_location_code: null, barcode: null, active: true,
  children_count: 0, position_x: 1, position_y: 1, width: 1, depth: 1,
  orientation: 0, rack_levels: 1, zone_type: 'pick', last_printed_at: null,
  warehouse_name: null, ...overrides,
});
const bins = [zone('EMPTY'), zone('LOW', { position_x: 3 }), zone('FULL', { position_x: 5 })];
const occupancy = { LOW: { on_hand_quantity: 2, variants: [] }, FULL: { on_hand_quantity: 20, variants: [] } };
const detail = (on_hand_quantity: number): LocationStockDetail => ({ on_hand_quantity, available_quantity: 0, reserved_quantity: 0, variants: [] });
const inspection = { EMPTY: detail(0), LOW: detail(2), FULL: detail(20) };
const props = { data: { zones: bins, product_barcodes: [] }, gridLocations: bins,
  isLoading: false, isError: false, onRefresh: jest.fn() };

it('counts empty and populated bins using explicit canonical knowledge', () => {
  render(<FloorPlanningModuleFT2 {...props} gridOccupancy={occupancy} inventoryInspection={inspection} />);
  expect(screen.getByText('1 out of stock')).toBeVisible();
  expect(screen.getByText('1 low on stock')).toBeVisible();
});

it('distinguishes unavailable responses, absent canonical records and explicit zero', () => {
  const { rerender } = render(<FloorPlanningModuleFT2 {...props} />);
  expect(screen.getByText('Occupancy unavailable')).toBeVisible();
  expect(screen.queryByText(/\d+ out of stock/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('EMPTY', { selector: 'text' }));
  expect(screen.getByText('Occupancy information is unavailable.')).toBeVisible();
  expect(screen.queryByText('Nothing stored here right now.')).not.toBeInTheDocument();
  rerender(<FloorPlanningModuleFT2 {...props} gridOccupancy={{}} />);
  expect(screen.getByText('0 out of stock')).toBeVisible();
  expect(screen.getByText('3 unknown')).toBeVisible();
  expect(screen.getByText('Occupancy information is unavailable.')).toBeVisible();
  rerender(<FloorPlanningModuleFT2 {...props} gridOccupancy={{}} inventoryInspection={{ EMPTY: detail(0) }} />);
  expect(screen.getByText('1 out of stock')).toBeVisible();
  expect(screen.getByText('2 unknown')).toBeVisible();
  expect(screen.getByText('Nothing stored here right now.')).toBeVisible();
});

it('counts actual lanes rather than the parents of bins', () => {
  const zones = [zone('AISLE', { type: 'lane' }), zone('RACK'),
    zone('CHILD', { parent_location_code: 'RACK', position_x: null, position_y: null })];
  render(<FloorPlanningModuleFT2 {...props} data={{ zones, product_barcodes: [] }} gridLocations={zones} gridOccupancy={{}} />);
  expect(screen.getByText('2 bins across 1 aisle · 0 bins with stock')).toBeVisible();
});

it('keeps rack and shelf child identities off the floor while warning about genuine unplaced objects', () => {
  const zones = [zone('RACK'), zone('SHELF', { type: 'shelf' }),
    zone('CHILD', { parent_location_code: 'RACK', position_x: null, position_y: null }),
    zone('LEGACY', { parent_location_code: 'SHELF', position_x: 7 }),
    zone('UNPLACED', { position_x: null, position_y: null }),
    zone('ORPHAN', { parent_location_code: 'MISSING', position_y: null })];
  render(<FloorPlanningModuleFT2 {...props} data={{ zones, product_barcodes: [] }} gridLocations={zones} />);
  expect(screen.getByText('2 locations not placed on the floor')).toBeVisible();
  expect(screen.queryByText('LEGACY', { selector: 'text' })).not.toBeInTheDocument();
  expect(screen.getByText('RACK', { selector: 'text' })).toBeInTheDocument();
});

it('counts lanes even when bins have no parent links', () => {
  const zones = [zone('AISLE-1', { type: 'lane' }), zone('AISLE-2', { type: 'lane' }), ...bins];
  render(<FloorPlanningModuleFT2 {...props} data={{ zones, product_barcodes: [] }} gridLocations={zones} gridOccupancy={{}} />);
  expect(screen.getByText('3 bins across 2 aisles · 0 bins with stock')).toBeVisible();
});

function topFill(container: HTMLElement, code: string) {
  const label = Array.from(container.querySelectorAll('text')).find(node => node.textContent === code);
  return label?.closest('g')?.querySelector('polygon')?.getAttribute('fill');
}

it('keeps negative and unknown locations distinct from empty in the heatmap, overlay and Inspector', () => {
  const zones = [...bins, zone('NEGATIVE', { position_x: 7 }), zone('UNKNOWN', { position_x: 9 })];
  const canonical = { ...inspection, NEGATIVE: detail(-2) };
  const { container } = render(<FloorPlanningModuleFT2 {...props} data={{ zones, product_barcodes: [] }}
    gridLocations={zones} gridOccupancy={occupancy} inventoryInspection={canonical} />);
  expect(screen.getByText('1 out of stock')).toBeVisible();
  expect(screen.getByText('1 unknown')).toBeVisible();
  expect(topFill(container, 'NEGATIVE')).not.toBe(topFill(container, 'EMPTY'));
  expect(topFill(container, 'UNKNOWN')).not.toBe(topFill(container, 'EMPTY'));
  fireEvent.click(screen.getByText('NEGATIVE', { selector: 'text' }));
  expect(screen.getByText('-2 units')).toBeVisible();
  expect(screen.getByText('Negative inventory is recorded here.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Empty bins' }));
  expect(topFill(container, 'NEGATIVE')).not.toBe(topFill(container, 'EMPTY'));
  expect(topFill(container, 'UNKNOWN')).not.toBe(topFill(container, 'EMPTY'));
  fireEvent.click(screen.getByText('UNKNOWN', { selector: 'text' }));
  expect(screen.getByText('Occupancy information is unavailable.')).toBeVisible();
  expect(screen.queryByText('Nothing stored here right now.')).not.toBeInTheDocument();
});

it('preserves positive Inspector quantities and heatmap coloring', () => {
  const { container, rerender } = render(<FloorPlanningModuleFT2 {...props} gridOccupancy={occupancy} />);
  const positiveFill = topFill(container, 'LOW');
  rerender(<FloorPlanningModuleFT2 {...props} gridOccupancy={occupancy} inventoryInspection={inspection} />);
  expect(topFill(container, 'LOW')).toBe(positiveFill);
  fireEvent.click(screen.getByText('LOW', { selector: 'text' }));
  expect(screen.getByText('2 units')).toBeVisible();
});
