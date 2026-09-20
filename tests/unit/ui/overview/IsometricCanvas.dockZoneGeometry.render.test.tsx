// tests/unit/ui/overview/IsometricCanvas.dockZoneGeometry.render.test.tsx
//
// OVERVIEW-LIVE-MAP-01 Slice D.2 — PART B: RECEIVE-1/SHIP-1 geometry
// correction. AUDIT FINDING: dock zones whose resolved dockBay is 'east'
// (dock_face: 'east', or auto-resolved closest to the floor's east edge —
// plausible for a SHIP/RECEIVE apron on a typical warehouse layout) built a
// top-face polygon with `t10` placed AFTER the notch trace instead of
// before it. That ordering crosses the edge t00->p(wx+ww,y0) over the edge
// p(wx+ww,y1)->t10 — a mathematically self-intersecting polygon — while the
// side walls below it were already correctly notched, producing the
// "detached" side faces seen in live-browser verification. north/south/west
// were already correctly ordered (verified by direct comparison) and are
// unchanged.
//
// Proof style: point-level polygon geometry (self-intersection + shared
// vertices between the top face and its walls), never pixel/screenshot
// assertions.

import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { IsometricCanvas, type WarehouseZone } from '@lasyncro/shared/ui';

function polygonPoints(el: SVGPolygonElement): [number, number][] {
  return (el.getAttribute('points') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return [x, y] as [number, number];
    });
}

/** Cross-product orientation test for segment intersection (excludes shared endpoints). */
function ccw(a: [number, number], b: [number, number], c: [number, number]): number {
  return (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function segmentsCross(
  p1: [number, number], p2: [number, number],
  p3: [number, number], p4: [number, number]
): boolean {
  const d1 = ccw(p3, p4, p1);
  const d2 = ccw(p3, p4, p2);
  const d3 = ccw(p1, p2, p3);
  const d4 = ccw(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when no two NON-ADJACENT edges of the polygon cross — a simple (non-self-intersecting) polygon. */
function isSimplePolygon(points: [number, number][]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Skip edges adjacent to edge i (share a vertex) — those legitimately "touch".
      if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % n];
      if (segmentsCross(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

function makeZone(overrides: Partial<WarehouseZone> = {}): WarehouseZone {
  return {
    location_code: 'SHIP-1',
    type: 'bin',
    parent_location_code: null,
    barcode: null,
    active: true,
    children_count: 0,
    position_x: 2,
    position_y: 1,
    width: 1,
    depth: 0.5,
    orientation: 0,
    rack_levels: 1,
    zone_type: 'ship',
    dock_face: 'east',
    last_printed_at: null,
    warehouse_name: null,
    ...overrides,
  };
}

function boxGroupForZone(container: HTMLElement, locationCode: string): SVGGElement {
  const textEl = Array.from(container.querySelectorAll('text')).find(
    (t) => t.textContent === locationCode
  );
  if (!textEl) throw new Error(`No rendered label found for ${locationCode}`);
  return textEl.closest('g') as unknown as SVGGElement;
}

describe('4-5: dock zone (RECEIVE-like / SHIP-like) top face is a simple polygon whose walls share its corners', () => {
  it('SHIP-1 (dock_face: east) top face is not self-intersecting', () => {
    const { container } = render(<IsometricCanvas zones={[makeZone()]} />);
    const boxGroup = boxGroupForZone(container, 'SHIP-1');
    const topFace = boxGroup.querySelector('polygon') as SVGPolygonElement;
    expect(isSimplePolygon(polygonPoints(topFace))).toBe(true);
  });

  it('RECEIVE-1 (dock_face: east) top face is not self-intersecting — same contract as SHIP-1', () => {
    const zone = makeZone({ location_code: 'RECEIVE-1', zone_type: 'receive' });
    const { container } = render(<IsometricCanvas zones={[zone]} />);
    const boxGroup = boxGroupForZone(container, 'RECEIVE-1');
    const topFace = boxGroup.querySelector('polygon') as SVGPolygonElement;
    expect(isSimplePolygon(polygonPoints(topFace))).toBe(true);
  });

  it('every wall polygon shares at least one vertex with the top face (no detached side geometry)', () => {
    const { container } = render(<IsometricCanvas zones={[makeZone()]} />);
    const boxGroup = boxGroupForZone(container, 'SHIP-1');
    const polygons = Array.from(boxGroup.querySelectorAll('polygon'));
    const topFacePoints = new Set(polygonPoints(polygons[0]).map(([x, y]) => `${x},${y}`));
    const wallPolygons = polygons.slice(1);
    expect(wallPolygons.length).toBeGreaterThan(0);
    for (const wall of wallPolygons) {
      const wallPoints = polygonPoints(wall as SVGPolygonElement);
      const sharesVertex = wallPoints.some(([x, y]) => topFacePoints.has(`${x},${y}`));
      expect(sharesVertex).toBe(true);
    }
  });

  it('covers every dockBay direction (north/south/west also remain simple polygons)', () => {
    for (const dock_face of ['north', 'south', 'west'] as const) {
      const zone = makeZone({ location_code: `DOCK-${dock_face}`, dock_face });
      const { container } = render(<IsometricCanvas zones={[zone]} />);
      const boxGroup = boxGroupForZone(container, `DOCK-${dock_face}`);
      const topFace = boxGroup.querySelector('polygon') as SVGPolygonElement;
      expect(isSimplePolygon(polygonPoints(topFace))).toBe(true);
    }
  });
});

describe('6: a correctly rendered neighboring zone (no dock bay) remains unchanged', () => {
  it('PACK-1 (zone_type: pack, no dock_face) keeps its plain 4-point top face', () => {
    const zone = makeZone({
      location_code: 'PACK-1',
      zone_type: 'pack',
      dock_face: undefined,
    });
    const { container } = render(<IsometricCanvas zones={[zone]} />);
    const boxGroup = boxGroupForZone(container, 'PACK-1');
    const topFace = boxGroup.querySelector('polygon') as SVGPolygonElement;
    const points = polygonPoints(topFace);
    expect(points.length).toBe(4);
    expect(isSimplePolygon(points)).toBe(true);
  });
});

describe('7: flipped rendering stays geometrically attached', () => {
  it('SHIP-1 (dock_face: east) top face is still a simple polygon after toggling mirrored view', () => {
    const { container } = render(<IsometricCanvas zones={[makeZone()]} showControls />);
    const flipToggle = container.querySelector('[title="Switch to mirrored view"]');
    expect(flipToggle).toBeTruthy();
    fireEvent.click(flipToggle!);

    const boxGroup = boxGroupForZone(container, 'SHIP-1');
    const topFace = boxGroup.querySelector('polygon') as SVGPolygonElement;
    expect(isSimplePolygon(polygonPoints(topFace))).toBe(true);
  });
});

describe('8: no station-apron regression', () => {
  it('synthetic stations (never dock-bay geometry) render without error alongside a dock-face zone', () => {
    const floorZone = makeZone({
      location_code: 'FLOOR',
      type: 'warehouse',
      zone_type: null,
      dock_face: undefined,
      position_x: 0,
      position_y: 0,
      width: 5,
      depth: 5,
    });
    expect(() =>
      render(
        <IsometricCanvas
          zones={[floorZone, makeZone()]}
          stations={[{ id: 'pool', label: 'Order Pool', side: 'inbound', count: 5, rank: 1 }]}
        />
      )
    ).not.toThrow();
  });
});
