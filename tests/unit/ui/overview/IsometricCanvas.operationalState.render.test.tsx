// tests/unit/ui/overview/IsometricCanvas.operationalState.render.test.tsx
//
// OVERVIEW-LIVE-MAP-01 Slice C — shared IsometricCanvas operational-state
// rendering contract. The renderer only PAINTS the caller-supplied
// OperationalMapState — it never infers severity, timing, or business
// meaning. Covers:
//   1  neutral physical location preserves existing base rendering path
//   2  active physical location receives operational active treatment
//   3  critical physical location receives critical treatment
//   4  selected critical location retains both selected and critical semantics
//   5  stale and warning map to amber-family operational treatment
//   6  healthy maps to green-family operational treatment
//   7  staged station with operational state active does NOT use legacy
//      critical visual semantics
//   8  caller without operational-state props preserves existing behavior
//
// Assertions read stable style-token attributes (stroke/fill on the existing
// top-face polygon) rather than exact SVG path strings or DOM shape, per the
// brief's anti-brittleness guidance.

import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import {
  IsometricCanvas,
  resolveOperationalVisualTreatment,
  type OperationalMapState,
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

/** Locates the top-face <polygon> of a rendered bin by its printed location-code label. */
function topFacePolygonForZone(container: HTMLElement, locationCode: string): SVGPolygonElement {
  const textEl = Array.from(container.querySelectorAll('text')).find(
    (t) => t.textContent === locationCode
  );
  if (!textEl) throw new Error(`No rendered label found for ${locationCode}`);
  const boxGroup = textEl.closest('g');
  if (!boxGroup) throw new Error(`No enclosing <g> found for ${locationCode}`);
  const polygon = boxGroup.querySelector('polygon');
  if (!polygon) throw new Error(`No top-face polygon found for ${locationCode}`);
  return polygon as unknown as SVGPolygonElement;
}

/** Locates a synthetic station's outer <g> (three sibling bar polygons) by its label text. */
function stationGroupByLabel(container: HTMLElement, label: string): SVGGElement {
  const textEl = Array.from(container.querySelectorAll('text')).find(
    (t) => t.textContent === label
  );
  if (!textEl) throw new Error(`No rendered label found for station ${label}`);
  // The label lives inside EdgeLabelPlate's own <g>; the station's outer <g>
  // (which owns the three bar polygons) is its parent.
  const plateGroup = textEl.closest('g');
  const stationGroup = plateGroup?.parentElement;
  if (!stationGroup || stationGroup.tagName !== 'g') {
    throw new Error(`Could not resolve station group for ${label}`);
  }
  return stationGroup as unknown as SVGGElement;
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

/**
 * Station placement (stationPlacements) is anchored off worldBounds, which is
 * null with zero positioned zones — so station-only tests still need one
 * minimal floor zone to establish a non-null bbox. It renders as an
 * unlabeled flat frame tile and never collides with station label queries.
 */
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

describe('resolveOperationalVisualTreatment — pure state->treatment mapping', () => {
  it('neutral and undefined resolve to no overlay', () => {
    expect(resolveOperationalVisualTreatment(undefined)).toBeNull();
    expect(resolveOperationalVisualTreatment('neutral')).toBeNull();
  });

  it('active resolves to the blue (space-azure) token', () => {
    expect(resolveOperationalVisualTreatment('active')?.stroke).toBe('var(--space-azure)');
  });

  it('healthy resolves to the green (good-ink) token, quieter than active/critical', () => {
    const healthy = resolveOperationalVisualTreatment('healthy')!;
    const active = resolveOperationalVisualTreatment('active')!;
    const critical = resolveOperationalVisualTreatment('critical')!;
    expect(healthy.stroke).toBe('var(--good-ink)');
    expect(healthy.ringOpacity).toBeLessThan(active.ringOpacity);
    expect(healthy.ringOpacity).toBeLessThan(critical.ringOpacity);
    expect(healthy.strokeWidth).toBeLessThan(active.strokeWidth);
    expect(healthy.strokeWidth).toBeLessThan(critical.strokeWidth);
  });

  it('stale and warning share the amber (warning-ink) family, warning stronger than stale', () => {
    const stale = resolveOperationalVisualTreatment('stale')!;
    const warning = resolveOperationalVisualTreatment('warning')!;
    expect(stale.stroke).toBe('var(--warning-ink)');
    expect(warning.stroke).toBe('var(--warning-ink)');
    expect(warning.strokeWidth).toBeGreaterThan(stale.strokeWidth);
    expect(warning.ringOpacity).toBeGreaterThan(stale.ringOpacity);
  });

  it('critical resolves to the red (critical-ink) token and is the strongest treatment', () => {
    const critical = resolveOperationalVisualTreatment('critical')!;
    const allOthers: OperationalMapState[] = ['active', 'healthy', 'stale', 'warning'];
    expect(critical.stroke).toBe('var(--critical-ink)');
    for (const s of allOthers) {
      expect(critical.strokeWidth).toBeGreaterThanOrEqual(resolveOperationalVisualTreatment(s)!.strokeWidth);
    }
  });
});

describe('IsometricCanvas — physical location operational-state rendering', () => {
  it('1: neutral location (no entry in operationalStateByLocation) preserves the existing base rendering path', () => {
    const zones = [makeZone()];
    const { container } = render(<IsometricCanvas zones={zones} operationalStateByLocation={{}} />);
    const polygon = topFacePolygonForZone(container, 'A-1-B-1');
    // Base rendering: no operational stroke token, no critical-red border.
    expect(polygon.getAttribute('stroke')).not.toBe('var(--space-azure)');
    expect(polygon.getAttribute('stroke')).not.toBe('var(--critical-ink)');
    expect(polygon.getAttribute('stroke')).not.toBe('var(--warning-ink)');
    expect(polygon.getAttribute('stroke')).not.toBe('var(--good-ink)');
  });

  it('2: active location receives the blue operational treatment', () => {
    const zones = [makeZone()];
    const { container } = render(
      <IsometricCanvas
        zones={zones}
        operationalStateByLocation={{ 'A-1-B-1': 'active' }}
      />
    );
    const polygon = topFacePolygonForZone(container, 'A-1-B-1');
    expect(polygon.getAttribute('stroke')).toBe('var(--space-azure)');
  });

  it('3: critical location receives the red operational treatment', () => {
    const zones = [makeZone()];
    const { container } = render(
      <IsometricCanvas
        zones={zones}
        operationalStateByLocation={{ 'A-1-B-1': 'critical' }}
      />
    );
    const polygon = topFacePolygonForZone(container, 'A-1-B-1');
    expect(polygon.getAttribute('stroke')).toBe('var(--critical-ink)');
    expect(Number(polygon.getAttribute('stroke-width'))).toBeGreaterThan(1);
  });

  it('4: a selected critical location retains BOTH selected and critical semantics', () => {
    const zones = [makeZone()];
    const { container } = render(
      <IsometricCanvas
        zones={zones}
        operationalStateByLocation={{ 'A-1-B-1': 'critical' }}
      />
    );
    const textEl = Array.from(container.querySelectorAll('text')).find(
      (t) => t.textContent === 'A-1-B-1'
    )!;
    const boxGroup = textEl.closest('g')!;
    // Clicking the box group's own onClick handler selects the bin.
    fireEvent.click(boxGroup);

    // Selection outline (dashed accent stroke) is present...
    const dashedSelectionRing = Array.from(boxGroup.querySelectorAll('polygon')).find(
      (p) => p.getAttribute('stroke-dasharray') === '4 2'
    );
    expect(dashedSelectionRing).toBeTruthy();
    expect(dashedSelectionRing!.getAttribute('stroke')).toBe('var(--accent)');

    // ...while the critical treatment (red ring fill + red top-face stroke) is still present.
    const criticalRing = Array.from(boxGroup.querySelectorAll('polygon')).find(
      (p) => p.getAttribute('fill') === 'var(--critical-ink)'
    );
    expect(criticalRing).toBeTruthy();
  });

  it('5: stale and warning both render the amber operational family', () => {
    const zones = [makeZone({ location_code: 'STALE-1' }), makeZone({ location_code: 'WARN-1' })];
    const { container } = render(
      <IsometricCanvas
        zones={zones}
        operationalStateByLocation={{ 'STALE-1': 'stale', 'WARN-1': 'warning' }}
      />
    );
    const stalePolygon = topFacePolygonForZone(container, 'STALE-1');
    const warnPolygon = topFacePolygonForZone(container, 'WARN-1');
    expect(stalePolygon.getAttribute('stroke')).toBe('var(--warning-ink)');
    expect(warnPolygon.getAttribute('stroke')).toBe('var(--warning-ink)');
    // Warning is the stronger intensity within the same amber family.
    expect(Number(warnPolygon.getAttribute('stroke-width'))).toBeGreaterThan(
      Number(stalePolygon.getAttribute('stroke-width'))
    );
  });

  it('6: healthy renders the green operational family', () => {
    const zones = [makeZone({ location_code: 'HEALTHY-1' })];
    const { container } = render(
      <IsometricCanvas
        zones={zones}
        operationalStateByLocation={{ 'HEALTHY-1': 'healthy' }}
      />
    );
    const polygon = topFacePolygonForZone(container, 'HEALTHY-1');
    expect(polygon.getAttribute('stroke')).toBe('var(--good-ink)');
  });

  it('8a: caller without operational-state props preserves existing zone rendering (no ring polygon)', () => {
    const zones = [makeZone(), makeZone({ location_code: 'A-1-B-2' })];
    const { container } = render(<IsometricCanvas zones={zones} />);
    const polygon = topFacePolygonForZone(container, 'A-1-B-1');
    expect(polygon.getAttribute('stroke')).not.toBe('var(--space-azure)');
    expect(polygon.getAttribute('stroke')).not.toBe('var(--good-ink)');
    expect(polygon.getAttribute('stroke')).not.toBe('var(--warning-ink)');
  });
});

describe('IsometricCanvas — synthetic station operational-state rendering', () => {
  it('7: staged station with operational state active does NOT use legacy critical visual semantics', () => {
    // OV-157b gives 'staged' a hardcoded tone: 'critical' for alarm styling,
    // even though its resolved operational state (Slice B) is 'active'.
    const stations = [baseStation({ id: 'staged', label: 'STAGED', tone: 'critical' })];
    const { container } = render(
      <IsometricCanvas
        zones={[floorAnchorZone()]}
        stations={stations}
        operationalStateByStation={{ staged: 'active' }}
      />
    );
    const group = stationGroupByLabel(container, 'STAGED');
    const topBar = group.querySelectorAll('polygon')[2];
    expect(topBar.getAttribute('fill')).toBe('var(--space-azure)');
    expect(topBar.getAttribute('fill')).not.toBe('var(--critical-ink)');
  });

  it('8b: station caller without operationalStateByStation preserves legacy tone-driven critical rendering', () => {
    const stations = [baseStation({ id: 'staged', label: 'STAGED', tone: 'critical' })];
    const { container } = render(<IsometricCanvas zones={[floorAnchorZone()]} stations={stations} />);
    const group = stationGroupByLabel(container, 'STAGED');
    const topBar = group.querySelectorAll('polygon')[2];
    expect(topBar.getAttribute('fill')).toBe('var(--critical-ink)');
  });

  it('8c: station caller without operationalStateByStation and without tone preserves legacy accent default', () => {
    const stations = [baseStation({ id: 'pool', label: 'POOL' })];
    const { container } = render(<IsometricCanvas zones={[floorAnchorZone()]} stations={stations} />);
    const group = stationGroupByLabel(container, 'POOL');
    const topBar = group.querySelectorAll('polygon')[2];
    expect(topBar.getAttribute('fill')).toBe('var(--accent)');
  });

  it('healthy station operational state (e.g. shipped) renders the green family, not legacy accent', () => {
    const stations = [baseStation({ id: 'shipped', label: 'SHIPPED', count: 4 })];
    const { container } = render(
      <IsometricCanvas
        zones={[floorAnchorZone()]}
        stations={stations}
        operationalStateByStation={{ shipped: 'healthy' }}
      />
    );
    const group = stationGroupByLabel(container, 'SHIPPED');
    const topBar = group.querySelectorAll('polygon')[2];
    expect(topBar.getAttribute('fill')).toBe('var(--good-ink)');
  });

  it('station click selects through the station callback without replacing operational fill semantics', () => {
    const onStationSelect = jest.fn();
    const stations = [baseStation({ id: 'blocked', label: 'BLOCKED', tone: 'critical' })];
    const { container } = render(
      <IsometricCanvas
        zones={[floorAnchorZone()]}
        stations={stations}
        operationalStateByStation={{ blocked: 'critical' }}
        onStationSelect={onStationSelect}
      />
    );
    const group = stationGroupByLabel(container, 'BLOCKED');
    fireEvent.click(group);
    expect(onStationSelect).toHaveBeenCalledWith('blocked');

    const topBar = group.querySelectorAll('polygon')[2];
    expect(topBar.getAttribute('fill')).toBe('var(--critical-ink)');
    expect(topBar.getAttribute('stroke')).toBe('var(--accent)');
    expect(topBar.getAttribute('stroke-dasharray')).toBe('4 2');
  });
});
