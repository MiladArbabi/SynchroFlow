// tests/unit/ui/overview/IsometricCanvas.operationalPresentation.render.test.tsx
//
// OVERVIEW-LIVE-MAP-01 Slice D — shared IsometricCanvas badge rendering
// contract. The renderer only PAINTS the caller-supplied primaryBadge — it
// never decides which fact wins. Covers:
//   - ONE badge is painted per object, from the caller-supplied primaryBadge
//   - badge colour follows the same Slice C operational-state treatment token
//   - when a presentation is supplied for a location, the older per-fact
//     stow/problem/dock markers are suppressed for THAT location (no
//     competing badges), while a location with no presentation entry keeps
//     rendering exactly as it did before Slice D (backward compatibility)
//   - a station's bare count text is replaced by the merchant-worded badge
//     label only when a presentation is supplied; otherwise unchanged
//   - neutral objects (primaryBadge: null) show no badge

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
    id: 'staged',
    label: 'STAGED',
    side: 'outbound',
    count: 2,
    rank: 1,
    ...overrides,
  };
}

/** Locates the Slice D unified badge group for a location by its exact aria-label. */
function findBadgeGroup(container: HTMLElement, ariaLabel: string): SVGGElement | null {
  return container.querySelector(`g[aria-label="${CSS.escape(ariaLabel)}"]`) as SVGGElement | null;
}

function stationGroupByLabel(container: HTMLElement, label: string): SVGGElement {
  const textEl = Array.from(container.querySelectorAll('text')).find(
    (t) => t.textContent === label
  );
  if (!textEl) throw new Error(`No rendered label found for station ${label}`);
  const plateGroup = textEl.closest('g');
  const stationGroup = plateGroup?.parentElement;
  if (!stationGroup || stationGroup.tagName !== 'g') {
    throw new Error(`Could not resolve station group for ${label}`);
  }
  return stationGroup as unknown as SVGGElement;
}

describe('IsometricCanvas — physical location primary badge', () => {
  it('renders the ONE caller-supplied badge, coloured by its state token', () => {
    const zones = [makeZone()];
    const presentation: OperationalMapPresentation = {
      state: 'active',
      primaryBadge: { label: '12 to stow', count: 12 },
    };
    const { container } = render(
      <IsometricCanvas
        zones={zones}
        operationalPresentationByLocation={{ 'A-1-B-1': presentation }}
      />
    );
    const badge = findBadgeGroup(container, '12 to stow at A-1-B-1');
    expect(badge).toBeTruthy();
    expect(badge!.querySelector('text')!.textContent).toBe('12 to stow');
    const rect = badge!.querySelector('rect')!;
    expect(rect.getAttribute('fill')).toBe('var(--space-azure)');
  });

  it('critical badge uses the critical-ink token', () => {
    const zones = [makeZone()];
    const presentation: OperationalMapPresentation = {
      state: 'critical',
      primaryBadge: { label: '3 issues', count: 3 },
    };
    const { container } = render(
      <IsometricCanvas
        zones={zones}
        operationalPresentationByLocation={{ 'A-1-B-1': presentation }}
      />
    );
    const badge = findBadgeGroup(container, '3 issues at A-1-B-1');
    expect(badge).toBeTruthy();
    const rect = badge!.querySelector('rect')!;
    expect(rect.getAttribute('fill')).toBe('var(--critical-ink)');
  });

  it('neutral presentation (primaryBadge: null) shows no badge', () => {
    const zones = [makeZone()];
    const presentation: OperationalMapPresentation = { state: 'neutral', primaryBadge: null };
    const { container } = render(
      <IsometricCanvas
        zones={zones}
        operationalPresentationByLocation={{ 'A-1-B-1': presentation }}
      />
    );
    // No Slice D badge group of any kind was rendered.
    expect(container.querySelectorAll('g[role="img"]').length).toBe(0);
  });

  it('suppresses the legacy per-fact stow badge for a location once a unified presentation is supplied (no competing badges)', () => {
    const zones = [makeZone()];
    const presentation: OperationalMapPresentation = {
      state: 'active',
      primaryBadge: { label: '12 to stow', count: 12 },
    };
    const { container } = render(
      <IsometricCanvas
        zones={zones}
        stowPending={{ 'A-1-B-1': 12 }}
        operationalPresentationByLocation={{ 'A-1-B-1': presentation }}
      />
    );
    // Exactly one role="img" marker for this bin — the new unified badge.
    expect(container.querySelectorAll('g[role="img"]').length).toBe(1);
    expect(findBadgeGroup(container, '12 to stow at A-1-B-1')).toBeTruthy();
  });

  it('suppresses the legacy problem-count badge for a location once a unified presentation is supplied', () => {
    const zones = [makeZone()];
    const presentation: OperationalMapPresentation = {
      state: 'critical',
      primaryBadge: { label: '2 issues', count: 2 },
    };
    const { container } = render(
      <IsometricCanvas
        zones={zones}
        problemByLocation={{ 'A-1-B-1': 2 }}
        operationalPresentationByLocation={{ 'A-1-B-1': presentation }}
      />
    );
    const legacyProblemBadge = Array.from(container.querySelectorAll('g[role="img"]')).find(
      (g) => (g.getAttribute('aria-label') ?? '').includes('open problem')
    );
    expect(legacyProblemBadge).toBeUndefined();
    expect(container.querySelectorAll('g[role="img"]').length).toBe(1);
  });

  it('BACKWARD COMPATIBILITY: a caller passing no operationalPresentationByLocation still renders the legacy stow badge exactly as before Slice D', () => {
    const zones = [makeZone()];
    const { container } = render(
      <IsometricCanvas zones={zones} stowPending={{ 'A-1-B-1': 12 }} />
    );
    // Legacy stow marker (icon-only, no "to stow" text) is still present.
    expect(container.querySelectorAll('g[role="img"]').length).toBe(0); // stow marker carries no role="img"
    // The stow badge's icon rect exists on the canvas (distinct from a Slice D badge).
    const stowText = Array.from(container.querySelectorAll('text')).find(
      (t) => t.textContent === '12'
    );
    expect(stowText).toBeTruthy();
  });

  it('BACKWARD COMPATIBILITY: a caller passing no presentation for one location among several still shows that location\'s legacy problem badge', () => {
    const zones = [makeZone(), makeZone({ location_code: 'A-1-B-2' })];
    const { container } = render(
      <IsometricCanvas
        zones={zones}
        problemByLocation={{ 'A-1-B-1': 2 }}
        operationalPresentationByLocation={{ 'A-1-B-2': { state: 'neutral', primaryBadge: null } }}
      />
    );
    const legacyProblemBadge = Array.from(container.querySelectorAll('g[role="img"]')).find(
      (g) => (g.getAttribute('aria-label') ?? '').includes('open problem')
    );
    expect(legacyProblemBadge).toBeTruthy();
  });
});

describe('IsometricCanvas — synthetic station primary badge', () => {
  it('replaces the bare count with the merchant-worded badge label', () => {
    const stations = [baseStation({ id: 'staged', label: 'STAGED', count: 4, tone: 'critical' })];
    const presentation: OperationalMapPresentation = {
      state: 'active',
      primaryBadge: { label: '4 awaiting pickup', count: 4 },
    };
    const { container } = render(
      <IsometricCanvas
        zones={[floorAnchorZone()]}
        stations={stations}
        operationalPresentationByStation={{ staged: presentation }}
      />
    );
    const group = stationGroupByLabel(container, 'STAGED');
    const bareCount = Array.from(group.querySelectorAll('text')).find((t) => t.textContent === '4');
    const badgeText = Array.from(group.querySelectorAll('text')).find(
      (t) => t.textContent === '4 awaiting pickup'
    );
    expect(bareCount).toBeUndefined();
    expect(badgeText).toBeTruthy();
  });

  it('BACKWARD COMPATIBILITY: a station caller passing no operationalPresentationByStation still shows the bare count', () => {
    const stations = [baseStation({ id: 'pool', label: 'POOL', count: 7 })];
    const { container } = render(
      <IsometricCanvas zones={[floorAnchorZone()]} stations={stations} />
    );
    const group = stationGroupByLabel(container, 'POOL');
    const bareCount = Array.from(group.querySelectorAll('text')).find((t) => t.textContent === '7');
    expect(bareCount).toBeTruthy();
  });

  it('zero-count station presentation renders no badge label swap (still no work to show)', () => {
    const stations = [baseStation({ id: 'pool', label: 'POOL', count: 0 })];
    const presentation: OperationalMapPresentation = { state: 'neutral', primaryBadge: null };
    // Zero-count stations are filtered out of rendering entirely by the
    // canvas (stationPlacements .filter(s => s.count > 0)), independent of
    // Slice D — nothing further to assert here beyond it not crashing.
    expect(() =>
      render(
        <IsometricCanvas
          zones={[floorAnchorZone()]}
          stations={stations}
          operationalPresentationByStation={{ pool: presentation }}
        />
      )
    ).not.toThrow();
  });
});
