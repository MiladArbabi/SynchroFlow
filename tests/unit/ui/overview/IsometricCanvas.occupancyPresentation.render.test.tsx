// tests/unit/ui/overview/IsometricCanvas.occupancyPresentation.render.test.tsx
//
// OVERVIEW-LIVE-MAP-01 Slice D.1 — PART A: occupancy/operational colour
// separation. On /overview, the occupancy heatmap must never make a neutral
// location look warning/critical — operational state (Slice C) owns the
// strong semantic colour channel. occupancyPresentation="neutral" suppresses
// ONLY the occupancy-driven base-fill override; topology, the `occupancy`
// data itself, operational-state treatment and selection are unaffected.
//
// Assertions read the top-face polygon's `fill`/`stroke` attributes — no
// pixel/visual snapshotting.

import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { IsometricCanvas, type WarehouseZone } from '@lasyncro/shared/ui';

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

// occupancyFraction >= 0.85 -> quarantine (red-family) fill under the legacy heatmap.
const HIGH_OCCUPANCY = { 'A-1-B-1': { on_hand_quantity: 10 } }; // rack_levels 1 -> capacity 10 -> fraction 1.0

describe('1: legacy caller (no occupancyPresentation) keeps the occupancy heatmap fill', () => {
  it('high occupancy on an otherwise neutral bin still paints the red/orange heatmap fill', () => {
    const { container } = render(
      <IsometricCanvas zones={[makeZone()]} occupancy={HIGH_OCCUPANCY} />
    );
    const polygon = topFacePolygonForZone(container, 'A-1-B-1');
    // rgba(...quarantine...) at 0.75 alpha, per IsometricBox's fillOverride thresholds.
    expect(polygon.getAttribute('fill')).toMatch(/0\.75\)$/);
  });
});

describe('2: Overview opt-in (occupancyPresentation="neutral") prevents high occupancy from producing a strong base fill', () => {
  it('the same high-occupancy bin renders its calm base fill instead', () => {
    const { container } = render(
      <IsometricCanvas
        zones={[makeZone()]}
        occupancy={HIGH_OCCUPANCY}
        occupancyPresentation="neutral"
      />
    );
    const polygon = topFacePolygonForZone(container, 'A-1-B-1');
    expect(polygon.getAttribute('fill')).not.toMatch(/0\.75\)$/);
    expect(polygon.getAttribute('fill')).not.toMatch(/0\.65\)$/);
    expect(polygon.getAttribute('fill')).not.toMatch(/0\.55\)$/);
    // No operational treatment supplied either -> no operational stroke token.
    expect(polygon.getAttribute('stroke')).not.toBe('var(--critical-ink)');
    expect(polygon.getAttribute('stroke')).not.toBe('var(--warning-ink)');
  });

  it('geometry/topology is unaffected — the same number of positioned zones render', () => {
    const zones = [makeZone(), makeZone({ location_code: 'A-1-B-2' })];
    const heatmapRender = render(
      <IsometricCanvas zones={zones} occupancy={HIGH_OCCUPANCY} />
    );
    const neutralRender = render(
      <IsometricCanvas zones={zones} occupancy={HIGH_OCCUPANCY} occupancyPresentation="neutral" />
    );
    const countPolygonsOnly = (c: HTMLElement) => c.querySelectorAll('polygon').length;
    expect(countPolygonsOnly(neutralRender.container)).toBe(countPolygonsOnly(heatmapRender.container));
  });
});

describe('3-5: operational-state treatment stays fully visible under occupancyPresentation="neutral"', () => {
  it('3: active still renders blue', () => {
    const { container } = render(
      <IsometricCanvas
        zones={[makeZone()]}
        occupancy={HIGH_OCCUPANCY}
        occupancyPresentation="neutral"
        operationalStateByLocation={{ 'A-1-B-1': 'active' }}
      />
    );
    const polygon = topFacePolygonForZone(container, 'A-1-B-1');
    expect(polygon.getAttribute('stroke')).toBe('var(--space-azure)');
  });

  it('4a: stale still amber', () => {
    const { container } = render(
      <IsometricCanvas
        zones={[makeZone()]}
        occupancy={HIGH_OCCUPANCY}
        occupancyPresentation="neutral"
        operationalStateByLocation={{ 'A-1-B-1': 'stale' }}
      />
    );
    const polygon = topFacePolygonForZone(container, 'A-1-B-1');
    expect(polygon.getAttribute('stroke')).toBe('var(--warning-ink)');
  });

  it('4b: warning still amber', () => {
    const { container } = render(
      <IsometricCanvas
        zones={[makeZone()]}
        occupancy={HIGH_OCCUPANCY}
        occupancyPresentation="neutral"
        operationalStateByLocation={{ 'A-1-B-1': 'warning' }}
      />
    );
    const polygon = topFacePolygonForZone(container, 'A-1-B-1');
    expect(polygon.getAttribute('stroke')).toBe('var(--warning-ink)');
  });

  it('5: critical still red', () => {
    const { container } = render(
      <IsometricCanvas
        zones={[makeZone()]}
        occupancy={HIGH_OCCUPANCY}
        occupancyPresentation="neutral"
        operationalStateByLocation={{ 'A-1-B-1': 'critical' }}
      />
    );
    const polygon = topFacePolygonForZone(container, 'A-1-B-1');
    expect(polygon.getAttribute('stroke')).toBe('var(--critical-ink)');
  });
});

describe('6: selected critical location remains both selected and critical under occupancyPresentation="neutral"', () => {
  it('selection outline and the critical ring both render', () => {
    const { container } = render(
      <IsometricCanvas
        zones={[makeZone()]}
        occupancy={HIGH_OCCUPANCY}
        occupancyPresentation="neutral"
        operationalStateByLocation={{ 'A-1-B-1': 'critical' }}
      />
    );
    const textEl = Array.from(container.querySelectorAll('text')).find(
      (t) => t.textContent === 'A-1-B-1'
    )!;
    const boxGroup = textEl.closest('g')!;
    fireEvent.click(boxGroup);

    const dashedSelectionRing = Array.from(boxGroup.querySelectorAll('polygon')).find(
      (p) => p.getAttribute('stroke-dasharray') === '4 2'
    );
    expect(dashedSelectionRing).toBeTruthy();
    expect(dashedSelectionRing!.getAttribute('stroke')).toBe('var(--accent)');

    const criticalRing = Array.from(boxGroup.querySelectorAll('polygon')).find(
      (p) => p.getAttribute('fill') === 'var(--critical-ink)'
    );
    expect(criticalRing).toBeTruthy();
  });
});

describe('7: other callers remain backward-compatible', () => {
  it('a caller passing occupancy but never occupancyPresentation is byte-for-byte unaffected by this slice', () => {
    const { container } = render(
      <IsometricCanvas zones={[makeZone()]} occupancy={HIGH_OCCUPANCY} />
    );
    const polygon = topFacePolygonForZone(container, 'A-1-B-1');
    expect(polygon.getAttribute('fill')).toMatch(/0\.75\)$/);
  });

  it('occupancyPresentation="heatmap" explicitly behaves exactly like omitting the prop', () => {
    const { container } = render(
      <IsometricCanvas zones={[makeZone()]} occupancy={HIGH_OCCUPANCY} occupancyPresentation="heatmap" />
    );
    const polygon = topFacePolygonForZone(container, 'A-1-B-1');
    expect(polygon.getAttribute('fill')).toMatch(/0\.75\)$/);
  });

  it('a caller with no occupancy prop at all is unaffected by occupancyPresentation="neutral" (nothing to suppress)', () => {
    const { container } = render(
      <IsometricCanvas zones={[makeZone()]} occupancyPresentation="neutral" />
    );
    const polygon = topFacePolygonForZone(container, 'A-1-B-1');
    expect(polygon.getAttribute('fill')).not.toMatch(/0\.75\)$/);
  });
});
