// tests/unit/ui/overview/IsometricCanvas.badgeLegibility.render.test.tsx
//
// OVERVIEW-LIVE-MAP-01 Slice D.2 — PART A: primary badge legibility
// correction. "8 blocked orders" was technically readable but too small at
// normal Overview zoom. The fix is a single shared sizing rule (zoom + label
// length via the same measureLabelPlateWidth heuristic the identity edge
// plate already uses) applied to the ONE OperationalBadge primitive — never
// a per-station-id special case. Covers:
//   1  long primary labels get a wider/taller pill than a short label
//   2  short labels remain compact (near the width floor)
//   3  critical/non-critical colour behaviour is unchanged
//   4  text still renders on one line (single <text>, no wrapping)
//   5  no second badge is introduced (still exactly one per object)

import React from 'react';
import { render } from '@testing-library/react';
import {
  IsometricCanvas,
  type OperationalMapPresentation,
  type WarehouseZone,
  type SyntheticStation,
} from '@lasyncro/shared/ui';

function makeZone(overrides: Partial<WarehouseZone> = {}): WarehouseZone {
  return {
    location_code: 'A-1-B-1',
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

function floorAnchorZone(): WarehouseZone {
  return makeZone({
    location_code: 'FLOOR',
    type: 'warehouse',
    position_x: 0,
    position_y: 0,
    width: 5,
    depth: 5,
  });
}

function baseStation(overrides: Partial<SyntheticStation> = {}): SyntheticStation {
  return {
    id: 'blocked',
    label: 'Blocked',
    side: 'outbound',
    count: 1,
    rank: 1,
    ...overrides,
  };
}

function findBadgeGroup(container: HTMLElement, ariaLabel: string): SVGGElement | null {
  return container.querySelector(`g[aria-label="${CSS.escape(ariaLabel)}"]`) as SVGGElement | null;
}

describe('1-2: badge dimensions scale with label length, off one shared rule', () => {
  it('a long label ("8 blocked orders") renders a visibly wider AND taller pill than the Slice D.1 baseline (10px height)', () => {
    const presentation: OperationalMapPresentation = {
      state: 'critical',
      primaryBadge: { label: '8 blocked orders', count: 8 },
    };
    const { container } = render(
      <IsometricCanvas
        zones={[makeZone()]}
        operationalPresentationByLocation={{ 'A-1-B-1': presentation }}
      />
    );
    const badge = findBadgeGroup(container, '8 blocked orders at A-1-B-1')!;
    const rect = badge.querySelector('rect')!;
    // zoom defaults to 0.9 -> height = 12 * 0.9 = 10.8, strictly above the
    // pre-D.2 baseline of 10 * 0.9 = 9.
    expect(Number(rect.getAttribute('height'))).toBeGreaterThan(9);
    // Wide enough to comfortably hold "8 blocked orders" — well past the
    // 20-unit floor scaled by zoom (18).
    expect(Number(rect.getAttribute('width'))).toBeGreaterThan(60);
  });

  it('a short label ("3 ready") stays compact, near the width floor', () => {
    const presentation: OperationalMapPresentation = {
      state: 'active',
      primaryBadge: { label: '3 ready', count: 3 },
    };
    const { container } = render(
      <IsometricCanvas
        zones={[makeZone()]}
        operationalPresentationByLocation={{ 'A-1-B-1': presentation }}
      />
    );
    const badge = findBadgeGroup(container, '3 ready at A-1-B-1')!;
    const rect = badge.querySelector('rect')!;
    expect(Number(rect.getAttribute('width'))).toBeLessThan(40);
  });

  it('a longer label always produces a strictly wider pill than a shorter one, at the same zoom', () => {
    const short: OperationalMapPresentation = {
      state: 'active',
      primaryBadge: { label: '3 ready', count: 3 },
    };
    const long: OperationalMapPresentation = {
      state: 'critical',
      primaryBadge: { label: '8 blocked orders', count: 8 },
    };
    const shortRender = render(
      <IsometricCanvas
        zones={[makeZone()]}
        operationalPresentationByLocation={{ 'A-1-B-1': short }}
      />
    );
    const longRender = render(
      <IsometricCanvas
        zones={[makeZone()]}
        operationalPresentationByLocation={{ 'A-1-B-1': long }}
      />
    );
    const shortWidth = Number(
      findBadgeGroup(shortRender.container, '3 ready at A-1-B-1')!.querySelector('rect')!.getAttribute('width')
    );
    const longWidth = Number(
      findBadgeGroup(longRender.container, '8 blocked orders at A-1-B-1')!.querySelector('rect')!.getAttribute('width')
    );
    expect(longWidth).toBeGreaterThan(shortWidth);
  });

  it('the same sizing rule applies to a synthetic station badge, not a per-station-id special case', () => {
    const presentation: OperationalMapPresentation = {
      state: 'critical',
      primaryBadge: { label: '8 blocked orders', count: 8 },
      showIdentityLabel: false,
    };
    const stations = [baseStation({ id: 'blocked', label: 'Blocked', count: 8 })];
    const { container } = render(
      <IsometricCanvas
        zones={[floorAnchorZone()]}
        stations={stations}
        operationalPresentationByStation={{ blocked: presentation }}
      />
    );
    const badge = findBadgeGroup(container, '8 blocked orders — Blocked')!;
    const rect = badge.querySelector('rect')!;
    expect(Number(rect.getAttribute('height'))).toBeGreaterThan(9);
    expect(Number(rect.getAttribute('width'))).toBeGreaterThan(60);
  });
});

describe('3: semantic colour behaviour is unchanged by the sizing correction', () => {
  it('critical badge still uses the critical-ink token', () => {
    const presentation: OperationalMapPresentation = {
      state: 'critical',
      primaryBadge: { label: '3 issues', count: 3 },
    };
    const { container } = render(
      <IsometricCanvas
        zones={[makeZone()]}
        operationalPresentationByLocation={{ 'A-1-B-1': presentation }}
      />
    );
    const badge = findBadgeGroup(container, '3 issues at A-1-B-1')!;
    expect(badge.querySelector('rect')!.getAttribute('fill')).toBe('var(--critical-ink)');
    expect(badge.querySelector('rect')!.getAttribute('opacity')).toBe('1');
  });

  it('non-critical (active) badge still uses the space-azure token and the lighter opacity', () => {
    const presentation: OperationalMapPresentation = {
      state: 'active',
      primaryBadge: { label: '12 to stow', count: 12 },
    };
    const { container } = render(
      <IsometricCanvas
        zones={[makeZone()]}
        operationalPresentationByLocation={{ 'A-1-B-1': presentation }}
      />
    );
    const badge = findBadgeGroup(container, '12 to stow at A-1-B-1')!;
    expect(badge.querySelector('rect')!.getAttribute('fill')).toBe('var(--space-azure)');
    expect(badge.querySelector('rect')!.getAttribute('opacity')).toBe('0.9');
  });
});

describe('4: text still renders on one line', () => {
  it('exactly one <text> element carries the full label, no wrapping/tspans', () => {
    const presentation: OperationalMapPresentation = {
      state: 'critical',
      primaryBadge: { label: '8 blocked orders', count: 8 },
    };
    const { container } = render(
      <IsometricCanvas
        zones={[makeZone()]}
        operationalPresentationByLocation={{ 'A-1-B-1': presentation }}
      />
    );
    const badge = findBadgeGroup(container, '8 blocked orders at A-1-B-1')!;
    const textEls = badge.querySelectorAll('text');
    expect(textEls.length).toBe(1);
    expect(textEls[0].querySelectorAll('tspan').length).toBe(0);
    expect(textEls[0].textContent).toBe('8 blocked orders');
  });
});

describe('5: no second badge is introduced by the sizing correction', () => {
  it('exactly one role="img" badge group renders per location', () => {
    const presentation: OperationalMapPresentation = {
      state: 'critical',
      primaryBadge: { label: '3 issues', count: 3 },
    };
    const { container } = render(
      <IsometricCanvas
        zones={[makeZone()]}
        operationalPresentationByLocation={{ 'A-1-B-1': presentation }}
      />
    );
    expect(container.querySelectorAll('g[role="img"]').length).toBe(1);
  });

  it('exactly one role="img" badge group renders per station', () => {
    const presentation: OperationalMapPresentation = {
      state: 'critical',
      primaryBadge: { label: '8 blocked orders', count: 8 },
      showIdentityLabel: false,
    };
    const stations = [baseStation({ id: 'blocked', label: 'Blocked', count: 8 })];
    const { container } = render(
      <IsometricCanvas
        zones={[floorAnchorZone()]}
        stations={stations}
        operationalPresentationByStation={{ blocked: presentation }}
      />
    );
    expect(container.querySelectorAll('g[role="img"]').length).toBe(1);
  });
});
