// tests/unit/ui/shared/IsometricCanvas.destination-highlight.render.test.tsx
//
// SF-STOW-UX-REFINEMENT-01 — opt-in destination emphasis in the shared
// renderer. 'confirmed' paints the WHOLE geometry (top face and every
// rack-level side slice) green with an open-bin cavity; 'suggested' is a
// restrained orange with no cavity. Absent, rendering is unchanged.

import React from 'react';
import { render } from '@testing-library/react';
import { IsometricCanvas, type WarehouseZone } from '@lasyncro/shared/ui';

function makeZone(overrides: Partial<WarehouseZone> = {}): WarehouseZone {
  return {
    location_code: 'B-1',
    type: 'bin',
    parent_location_code: null,
    barcode: null,
    active: true,
    children_count: 0,
    position_x: 1,
    position_y: 1,
    width: 1,
    depth: 1,
    orientation: 0,
    rack_levels: 3,
    zone_type: 'storage',
    last_printed_at: null,
    warehouse_name: null,
    ...overrides,
  };
}

const ZONES = [makeZone(), makeZone({ location_code: 'A-1', position_x: 4, rack_levels: 1 })];

function boxGroup(container: HTMLElement, locationCode: string): Element {
  const label = Array.from(container.querySelectorAll('text')).find((t) => t.textContent === locationCode);
  const group = label?.closest('g');
  if (!group) throw new Error(`No rendered box for ${locationCode}`);
  return group;
}

/** Side-face overlay polygons are the destination-tinted, stroke-less ones. */
function tintedSideFaces(group: Element, color: string): Element[] {
  return Array.from(group.querySelectorAll('polygon')).filter(
    (p) => p.getAttribute('fill') === color && p.getAttribute('stroke') === 'none',
  );
}

describe('IsometricCanvas destinationHighlight', () => {
  it('confirmed multilevel rack: whole rack green, every level, with no top opening', () => {
    const { container } = render(
      <IsometricCanvas zones={ZONES} destinationHighlight={{ locationCode: 'B-1', tone: 'confirmed' }} />,
    );
    const group = boxGroup(container, 'B-1');

    const top = group.querySelector('[data-destination-tone]');
    expect(top).toHaveAttribute('data-destination-tone', 'confirmed');
    expect(top).toHaveAttribute('fill', 'var(--good-ink)');
    // A top-face opening would point at the top shelf; no level is addressed.
    expect(group.querySelector('[data-testid="destination-open-bin"]')).toBeNull();
    // Two visible side faces per level, all three levels: never one level alone.
    expect(tintedSideFaces(group, 'var(--good-ink)')).toHaveLength(6);
  });

  it.each([
    ['one level', 1],
    ['an unknown level count', null],
  ])('confirmed single-level bin (%s): green and drawn as an open bin', (_label, rackLevels) => {
    const zones = [makeZone({ location_code: 'A-1', rack_levels: rackLevels })];
    const { container } = render(
      <IsometricCanvas zones={zones} destinationHighlight={{ locationCode: 'A-1', tone: 'confirmed' }} />,
    );
    const group = boxGroup(container, 'A-1');
    expect(group.querySelector('[data-destination-tone]')).toHaveAttribute('data-destination-tone', 'confirmed');
    expect(group.querySelector('[data-testid="destination-open-bin"]')).not.toBeNull();
    expect(tintedSideFaces(group, 'var(--good-ink)')).toHaveLength(2);
  });

  it('suggested: restrained orange across the geometry, no open bin', () => {
    const { container } = render(
      <IsometricCanvas zones={ZONES} destinationHighlight={{ locationCode: 'B-1', tone: 'suggested' }} />,
    );
    const group = boxGroup(container, 'B-1');

    expect(group.querySelector('[data-destination-tone]')).toHaveAttribute('data-destination-tone', 'suggested');
    expect(group.querySelector('[data-testid="destination-open-bin"]')).toBeNull();
    expect(tintedSideFaces(group, 'var(--accent)')).toHaveLength(6);
  });

  it('paints only the named location, and nothing when the prop is absent', () => {
    const lit = render(
      <IsometricCanvas zones={ZONES} destinationHighlight={{ locationCode: 'B-1', tone: 'confirmed' }} />,
    );
    expect(boxGroup(lit.container, 'A-1').querySelector('[data-destination-tone]')).toBeNull();
    lit.unmount();

    const plain = render(<IsometricCanvas zones={ZONES} />);
    expect(plain.container.querySelector('[data-destination-tone]')).toBeNull();
    expect(plain.container.querySelector('[data-testid="destination-open-bin"]')).toBeNull();
  });
});
