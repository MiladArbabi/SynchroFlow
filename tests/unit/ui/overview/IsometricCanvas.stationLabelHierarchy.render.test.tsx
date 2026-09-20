// tests/unit/ui/overview/IsometricCanvas.stationLabelHierarchy.render.test.tsx
//
// OVERVIEW-LIVE-MAP-01 Slice D.1 — PARTS B & C: synthetic-station label
// hierarchy and placement. The renderer only paints the already-resolved
// primary badge and an optional identity plate (showIdentityLabel) — it
// infers no business semantics from the station id. Covers:
//   5  blocked presentation is exactly "1 blocked order" / "N blocked orders"
//   6  blocked primary message suppresses the separate "Blocked" identity
//   7  staged primary message suppresses the "Awaiting pickup" identity
//   8  shipped primary message suppresses the "Shipped from floor" identity
//   9  Order Pool keeps BOTH "N ready" and "Order Pool"
//  10  the primary label anchors clearly above the block's top face, not at
//      the old central/overlapping position (stable geometric assertion)
//  11  a caller without presentation keeps the legacy bare-count + identity
//      behavior unchanged

import React from 'react';
import { render } from '@testing-library/react';
import {
  IsometricCanvas,
  type OperationalMapPresentation,
  type WarehouseZone,
  type SyntheticStation,
} from '@lasyncro/shared/ui';

function floorAnchorZone(): WarehouseZone {
  return {
    location_code: 'FLOOR',
    type: 'warehouse',
    parent_location_code: null,
    barcode: null,
    active: true,
    children_count: 0,
    position_x: 0,
    position_y: 0,
    width: 5,
    depth: 5,
    orientation: 0,
    rack_levels: null,
    zone_type: null,
    last_printed_at: null,
    warehouse_name: null,
  };
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

/** The Slice D primary badge is always rendered with role="img" and an aria-label. */
function findBadgeGroup(container: HTMLElement, ariaLabel: string): SVGGElement | null {
  return container.querySelector(`g[aria-label="${CSS.escape(ariaLabel)}"]`) as SVGGElement | null;
}

function identityPlateText(container: HTMLElement, label: string): Element | undefined {
  return Array.from(container.querySelectorAll('text')).find((t) => t.textContent === label);
}

/** Extracts the minimum screen-Y among a polygon's points (SVG y grows downward, so min = topmost). */
function minPolygonY(polygon: SVGPolygonElement): number {
  const points = (polygon.getAttribute('points') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((pair) => parseFloat(pair.split(',')[1]));
  return Math.min(...points);
}

describe('5: blocked badge wording is exactly "N blocked order(s)"', () => {
  it('singular: 1 blocked order', () => {
    const presentation: OperationalMapPresentation = {
      state: 'critical',
      primaryBadge: { label: '1 blocked order', count: 1 },
      showIdentityLabel: false,
    };
    const stations = [baseStation({ id: 'blocked', label: 'Blocked', count: 1 })];
    const { container } = render(
      <IsometricCanvas
        zones={[floorAnchorZone()]}
        stations={stations}
        operationalPresentationByStation={{ blocked: presentation }}
      />
    );
    const badge = findBadgeGroup(container, '1 blocked order — Blocked');
    expect(badge).toBeTruthy();
    expect(badge!.querySelector('text')!.textContent).toBe('1 blocked order');
  });

  it('plural: 8 blocked orders — never "8 blocked" or "Blocked: 8"', () => {
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
    const badge = findBadgeGroup(container, '8 blocked orders — Blocked');
    expect(badge).toBeTruthy();
    const text = badge!.querySelector('text')!.textContent;
    expect(text).toBe('8 blocked orders');
    expect(text).not.toBe('8 blocked');
    expect(text).not.toMatch(/^Blocked:/);
  });
});

describe('6-8: primary message suppresses redundant station identity', () => {
  it('6: blocked — no "Blocked" identity plate when showIdentityLabel is false', () => {
    const presentation: OperationalMapPresentation = {
      state: 'critical',
      primaryBadge: { label: '3 blocked orders', count: 3 },
      showIdentityLabel: false,
    };
    const stations = [baseStation({ id: 'blocked', label: 'Blocked', count: 3 })];
    const { container } = render(
      <IsometricCanvas
        zones={[floorAnchorZone()]}
        stations={stations}
        operationalPresentationByStation={{ blocked: presentation }}
      />
    );
    expect(identityPlateText(container, 'Blocked')).toBeUndefined();
    expect(findBadgeGroup(container, '3 blocked orders — Blocked')).toBeTruthy();
  });

  it('7: staged — no "Awaiting pickup" identity plate when showIdentityLabel is false', () => {
    const presentation: OperationalMapPresentation = {
      state: 'active',
      primaryBadge: { label: '4 awaiting pickup', count: 4 },
      showIdentityLabel: false,
    };
    const stations = [baseStation({ id: 'staged', label: 'Awaiting pickup', count: 4, tone: 'critical' })];
    const { container } = render(
      <IsometricCanvas
        zones={[floorAnchorZone()]}
        stations={stations}
        operationalPresentationByStation={{ staged: presentation }}
      />
    );
    expect(identityPlateText(container, 'Awaiting pickup')).toBeUndefined();
    expect(findBadgeGroup(container, '4 awaiting pickup — Awaiting pickup')).toBeTruthy();
  });

  it('8: shipped — no "Shipped from floor" identity plate when showIdentityLabel is false', () => {
    const presentation: OperationalMapPresentation = {
      state: 'healthy',
      primaryBadge: { label: '18 shipped', count: 18 },
      showIdentityLabel: false,
    };
    const stations = [baseStation({ id: 'shipped', label: 'Shipped from floor', count: 18 })];
    const { container } = render(
      <IsometricCanvas
        zones={[floorAnchorZone()]}
        stations={stations}
        operationalPresentationByStation={{ shipped: presentation }}
      />
    );
    expect(identityPlateText(container, 'Shipped from floor')).toBeUndefined();
    expect(findBadgeGroup(container, '18 shipped — Shipped from floor')).toBeTruthy();
  });
});

describe('9: Order Pool keeps BOTH the primary quantity badge and its identity', () => {
  it('renders "20 ready" AND the "Order Pool" identity plate', () => {
    const presentation: OperationalMapPresentation = {
      state: 'active',
      primaryBadge: { label: '20 ready', count: 20 },
      showIdentityLabel: true,
    };
    const stations = [baseStation({ id: 'pool', label: 'Order Pool', count: 20, side: 'inbound' })];
    const { container } = render(
      <IsometricCanvas
        zones={[floorAnchorZone()]}
        stations={stations}
        operationalPresentationByStation={{ pool: presentation }}
      />
    );
    expect(findBadgeGroup(container, '20 ready — Order Pool')).toBeTruthy();
    expect(identityPlateText(container, 'Order Pool')).toBeTruthy();
  });
});

describe('10: primary label placement — clearly above the block, not the old overlapping position', () => {
  it('the badge text sits at a smaller screen-Y (higher on screen) than every top-face corner', () => {
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
    const badgeY = parseFloat(badge.querySelector('text')!.getAttribute('y')!);

    const stationGroup = badge.parentElement!;
    // Third bar polygon is the top face (t00,t10,t11,t01) — painter order: front-left, right, top.
    const topFacePolygon = stationGroup.querySelectorAll('polygon')[2] as SVGPolygonElement;
    const topFaceMinY = minPolygonY(topFacePolygon);

    expect(badgeY).toBeLessThan(topFaceMinY);
  });
});

describe('11: BACKWARD COMPATIBILITY — a caller without operationalPresentationByStation keeps legacy behavior', () => {
  it('shows the bare count and always shows the identity plate', () => {
    const stations = [baseStation({ id: 'blocked', label: 'Blocked', count: 8 })];
    const { container } = render(
      <IsometricCanvas zones={[floorAnchorZone()]} stations={stations} />
    );
    const bareCount = Array.from(container.querySelectorAll('text')).find(
      (t) => t.textContent === '8'
    );
    expect(bareCount).toBeTruthy();
    expect(identityPlateText(container, 'Blocked')).toBeTruthy();
    // No Slice D/D.1 badge group at all.
    expect(container.querySelectorAll('g[role="img"]').length).toBe(0);
  });
});
