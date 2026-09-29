// GH-1177 — warehouse root must not manufacture an "unplaced location".
//
// The root is the floor boundary. #1176 intentionally permits a configured
// warehouse root to retain null position_x/position_y as an implicit origin.
// Only ordinary placeable child zones belong in the unplaced-location count.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { IsometricCanvas, type WarehouseZone } from '@lasyncro/shared/ui';

function zone(
  location_code: string,
  overrides: Partial<WarehouseZone> = {},
): WarehouseZone {
  return {
    location_code,
    type: 'bin',
    parent_location_code: 'WH-1-ROOT',
    barcode: null,
    active: true,
    children_count: 0,
    position_x: 1,
    position_y: 1,
    width: 1,
    depth: 0.5,
    orientation: 0,
    rack_levels: 1,
    zone_type: 'pick',
    last_printed_at: null,
    warehouse_name: null,
    ...overrides,
  };
}

const warehouseRoot = zone('WH-1-ROOT', {
  type: 'warehouse',
  parent_location_code: null,
  zone_type: null,
  position_x: null,
  position_y: null,
  width: 12,
  depth: 10,
  rack_levels: null,
});

describe('GH1177 — IsometricCanvas unplaced-zone semantics', () => {
  it('does not count the implicit-origin warehouse root as an unplaced location', () => {
    render(
      <IsometricCanvas
        zones={[warehouseRoot]}
      />
    );

    expect(
      screen.queryByText(/location.*not placed on the floor/i),
    ).not.toBeInTheDocument();
  });

  it('counts one unplaced stock location without also counting the warehouse root', () => {
    const unplacedStock = zone('PICK-01', {
      position_x: null,
      position_y: null,
    });

    render(
      <IsometricCanvas
        zones={[warehouseRoot, unplacedStock]}
      />
    );

    expect(
      screen.getByText('1 location not placed on the floor'),
    ).toBeInTheDocument();

    expect(
      screen.queryByText('2 locations not placed on the floor'),
    ).not.toBeInTheDocument();
  });

  it('still counts an ordinary child when either coordinate is missing', () => {
    const partiallyPositionedStock = zone('PICK-02', {
      position_x: 2,
      position_y: null,
    });

    render(
      <IsometricCanvas
        zones={[warehouseRoot, partiallyPositionedStock]}
      />
    );

    expect(
      screen.getByText('1 location not placed on the floor'),
    ).toBeInTheDocument();
  });
});
