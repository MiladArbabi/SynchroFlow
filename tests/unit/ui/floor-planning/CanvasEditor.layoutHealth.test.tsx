import { render, screen } from '@testing-library/react';
import type { WarehouseZone } from '../../../../modules/floor-planning/src/ui/pages/FloorPlanningModuleFT2';
import { CanvasEditor } from '../../../../modules/floor-planning/src/ui/components/CanvasEditor';

function zone(overrides: Partial<WarehouseZone> = {}): WarehouseZone {
  return {
    location_code: 'ZONE-01',
    type: 'bin',
    parent_location_code: null,
    barcode: 'LOC-ZONE-01',
    active: true,
    children_count: 0,
    position_x: 1,
    position_y: 1,
    width: 2,
    depth: 2,
    orientation: 0,
    rack_levels: 1,
    zone_type: 'pick',
    last_printed_at: null,
    warehouse_name: null,
    ...overrides,
  };
}

describe('GH1177 — CanvasEditor Layout Health semantics', () => {
  it('does not treat an ungrouped stock location as a missing-aisle defect', () => {
    render(
      <CanvasEditor
        zones={[
          zone({
            location_code: 'PICK-01',
            zone_type: 'pick',
            parent_location_code: null,
          }),
        ]}
      />
    );

    expect(screen.queryByText(/no parent aisle/i)).not.toBeInTheDocument();
  });

  it('does not require Pack, Receive or Ship work areas to have aisle parents', () => {
    render(
      <CanvasEditor
        zones={[
          zone({
            location_code: 'PACK-01',
            zone_type: 'pack',
            parent_location_code: null,
          }),
          zone({
            location_code: 'RECEIVE-01',
            zone_type: 'receive',
            parent_location_code: null,
          }),
          zone({
            location_code: 'SHIP-01',
            zone_type: 'ship',
            parent_location_code: null,
          }),
        ]}
      />
    );

    expect(screen.queryByText(/no parent aisle/i)).not.toBeInTheDocument();
  });

  it('does not report barcode=null as unhealthy when physical location_code identity exists', () => {
    const aisle = zone({
      location_code: 'AISLE-01',
      type: 'lane',
      zone_type: 'pick',
      parent_location_code: null,
      barcode: null,
    });

    const stock = zone({
      location_code: 'PICK-01',
      type: 'bin',
      zone_type: 'pick',
      parent_location_code: 'AISLE-01',
      barcode: null,
    });

    render(<CanvasEditor zones={[aisle, stock]} />);

    expect(screen.queryByText(/without a barcode/i)).not.toBeInTheDocument();
  });

  it('still reports a real placement problem', () => {
    render(
      <CanvasEditor
        zones={[
          zone({
            location_code: 'PACK-01',
            zone_type: 'pack',
            parent_location_code: null,
            position_x: null,
          }),
        ]}
      />
    );

    expect(
      screen.getByText('1 zone not placed on the floor')
    ).toBeInTheDocument();
  });
});
