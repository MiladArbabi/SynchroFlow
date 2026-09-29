// tests/unit/ui/shared/IsometricCanvas.occupancy-knowledge.render.test.tsx
//
// INVENTORY INTELLIGENCE RED-C — known vs unknown occupancy in the shared,
// domain-neutral renderer.
//
// Target generic prop: knownOccupancyLocationCodes?: ReadonlySet<string>
// - omitted: historic behaviour — once an `occupancy` record is supplied, a
//   bin missing from it paints the empty (zero) occupancy tier;
// - supplied: a KNOWN code with a missing or zero occupancy entry may paint
//   that empty tier (confirmed zero); an UNKNOWN code must NOT paint it just
//   because its entry is missing — it keeps the base fill it would have with
//   no occupancy knowledge at all.
//
// Assertions compare the top-face polygon `fill` of the same bin across
// renders (the seam IsometricCanvas.occupancyPresentation.render.test.tsx
// uses) instead of hard-coding colour strings.

import React from 'react';
import { render } from '@testing-library/react';
import { IsometricCanvas, type WarehouseZone } from '@lasyncro/shared/ui';

function makeZone(overrides: Partial<WarehouseZone> = {}): WarehouseZone {
  return {
    location_code: 'KNOWN-1',
    type: 'bin',
    parent_location_code: null,
    barcode: null,
    active: true,
    children_count: 0,
    position_x: 1,
    position_y: 1,
    width: 1,
    depth: 0.5,
    orientation: 0,
    rack_levels: 1,
    zone_type: 'storage',
    last_printed_at: null,
    warehouse_name: null,
    ...overrides,
  };
}

function topFaceFill(container: HTMLElement, locationCode: string): string | null {
  const textEl = Array.from(container.querySelectorAll('text')).find(
    (t) => t.textContent === locationCode
  );
  if (!textEl) throw new Error(`No rendered label found for ${locationCode}`);
  const boxGroup = textEl.closest('g');
  if (!boxGroup) throw new Error(`No enclosing <g> found for ${locationCode}`);
  const polygon = boxGroup.querySelector('polygon');
  if (!polygon) throw new Error(`No top-face polygon found for ${locationCode}`);
  return polygon.getAttribute('fill');
}

// Generic prop not yet declared on IsometricCanvasProps.
const knownCodes = (codes: string[]) =>
  ({ knownOccupancyLocationCodes: new Set(codes) } as Record<string, unknown>);

const ZONES = [
  makeZone({ location_code: 'KNOWN-1', position_x: 1 }),
  makeZone({ location_code: 'UNKNOWN-1', position_x: 3 }),
];

function fillsFor(props: Record<string, unknown>) {
  const { container, unmount } = render(<IsometricCanvas zones={ZONES} {...props} />);
  const fills = {
    known: topFaceFill(container, 'KNOWN-1'),
    unknown: topFaceFill(container, 'UNKNOWN-1'),
  };
  unmount();
  return fills;
}

describe('IsometricCanvas — knownOccupancyLocationCodes (generic occupancy knowledge)', () => {
  // Baselines from today's renderer.
  const noKnowledge = () => fillsFor({});                    // no occupancy record at all
  const legacyEmpty = () => fillsFor({ occupancy: {} });     // record present, bins missing → empty tier

  it('control: the empty occupancy tier is visibly distinct from the no-knowledge base fill', () => {
    expect(legacyEmpty().unknown).not.toBe(noKnowledge().unknown);
  });

  it('omitted: historic behaviour — a bin missing from occupancy paints the empty tier', () => {
    const fills = fillsFor({ occupancy: {} });

    expect(fills.known).toBe(legacyEmpty().known);
    expect(fills.unknown).toBe(legacyEmpty().unknown);
  });

  it('supplied: a KNOWN code with a missing or zero entry paints the confirmed-zero (empty) tier', () => {
    expect(fillsFor({ occupancy: {}, ...knownCodes(['KNOWN-1']) }).known).toBe(legacyEmpty().known);
    expect(
      fillsFor({ occupancy: { 'KNOWN-1': { on_hand_quantity: 0 } }, ...knownCodes(['KNOWN-1']) }).known
    ).toBe(legacyEmpty().known);
  });

  it('supplied: an UNKNOWN code missing from occupancy is not painted as confirmed zero', () => {
    const fills = fillsFor({ occupancy: {}, ...knownCodes(['KNOWN-1']) });

    expect(fills.unknown).not.toBe(legacyEmpty().unknown);
    expect(fills.unknown).toBe(noKnowledge().unknown);
  });

  it('supplied: a KNOWN code with positive occupancy keeps its heatmap tier', () => {
    const occupancy = { 'KNOWN-1': { on_hand_quantity: 10 } }; // capacity 10 → high tier
    const withKnowledge = fillsFor({ occupancy, ...knownCodes(['KNOWN-1']) });
    const legacy = fillsFor({ occupancy });

    expect(withKnowledge.known).toBe(legacy.known);
  });
});
