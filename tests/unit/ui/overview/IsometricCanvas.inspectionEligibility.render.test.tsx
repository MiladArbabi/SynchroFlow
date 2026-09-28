// tests/unit/ui/overview/IsometricCanvas.inspectionEligibility.render.test.tsx
//
// C2D — optional physical-location inspection eligibility.
//
// inspectableLocationCodes absent  → historic behaviour: any physical bin may
//                                    enter hover focus and selection.
// present, code included           → same hover/selection behaviour.
// present, code excluded           → geometry renders, but the bin cannot
//                                    enter hover focus (no dimming, no plate)
//                                    or become the selected inspection target.
//
// Harness helpers mirror IsometricCanvas.pinnedPulse.render.test.tsx.

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { IsometricCanvas, type WarehouseZone } from '@lasyncro/shared/ui';

function zone(location_code: string, position_x: number): WarehouseZone {
  return {
    location_code,
    type: 'bin',
    parent_location_code: null,
    barcode: null,
    active: true,
    children_count: 0,
    position_x,
    position_y: 1,
    width: 1,
    depth: 0.5,
    orientation: 0,
    rack_levels: 1,
    zone_type: 'pick',
    last_printed_at: null,
    warehouse_name: null,
  };
}

function physicalBoxGroup(container: HTMLElement, locationCode: string): Element {
  const textEl = Array.from(container.querySelectorAll('text')).find(
    (t) => t.textContent === locationCode
  );
  if (!textEl) throw new Error(`Missing zone label ${locationCode}`);
  const boxGroup = textEl.closest('g');
  if (!boxGroup) throw new Error(`Missing box group for ${locationCode}`);
  return boxGroup;
}

const zones = [zone('A-1', 1), zone('B-1', 3)];
const locationPulseByCode = {
  'A-1': { title: 'A-1', rows: [{ label: 'Pickers here', value: '1' }] },
};

function renderCanvas(extra: Record<string, unknown> = {}) {
  const onSelect = jest.fn();
  const onZoneClick = jest.fn();
  const utils = render(
    <IsometricCanvas
      zones={zones}
      enableHoverFocus
      locationPulseByCode={locationPulseByCode}
      onSelect={onSelect}
      onZoneClick={onZoneClick}
      {...extra}
    />
  );
  return { ...utils, onSelect, onZoneClick };
}

function expectInspectable(container: HTMLElement, onSelect: jest.Mock) {
  const a1 = physicalBoxGroup(container, 'A-1');

  fireEvent.mouseEnter(a1.parentElement!);
  expect(screen.getByTestId('isometric-pulse-card')).toHaveAttribute('data-pinned', 'false');
  expect(physicalBoxGroup(container, 'B-1')).toHaveAttribute('opacity', '0.55');
  fireEvent.mouseLeave(a1.parentElement!);

  fireEvent.click(a1);
  expect(onSelect).toHaveBeenLastCalledWith('A-1');
  expect(screen.getByTestId('isometric-pulse-card')).toHaveAttribute('data-pinned', 'true');
}

describe('IsometricCanvas — inspectableLocationCodes eligibility', () => {
  it('A — absent: historic hover focus and selection remain possible', () => {
    const { container, onSelect } = renderCanvas();
    expectInspectable(container, onSelect);
  });

  it('B — provided with the code included: hover focus and selection remain possible', () => {
    const { container, onSelect } = renderCanvas({ inspectableLocationCodes: new Set(['A-1']) });
    expectInspectable(container, onSelect);
  });

  it('C — provided with the code excluded: no hover focus, no dimming, no selection, geometry still rendered', () => {
    const { container, onSelect, onZoneClick } = renderCanvas({ inspectableLocationCodes: new Set(['B-1']) });
    const a1 = physicalBoxGroup(container, 'A-1');

    fireEvent.mouseEnter(a1.parentElement!);
    expect(screen.queryByTestId('isometric-pulse-card')).not.toBeInTheDocument();
    expect(physicalBoxGroup(container, 'B-1')).not.toHaveAttribute('opacity', '0.55');

    fireEvent.click(a1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByTestId('isometric-pulse-card')).not.toBeInTheDocument();
    // onZoneClick is not an inspection contract and keeps firing.
    expect(onZoneClick).toHaveBeenCalledWith('A-1');
  });

  it('C — a controlled selection of an excluded code does not pin or outline it', () => {
    renderCanvas({
      inspectableLocationCodes: new Set(['B-1']),
      selectedLocationCode: 'A-1',
      pinnedAction: { label: 'Open order flow →', onClick: jest.fn() },
    });

    expect(screen.queryByTestId('isometric-pulse-card')).not.toBeInTheDocument();
    expect(screen.queryByText('Open order flow →')).not.toBeInTheDocument();
  });
});
