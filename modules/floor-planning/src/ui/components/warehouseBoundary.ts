// modules/floor-planning/src/ui/components/warehouseBoundary.ts
//
// GH-1176 — the warehouse root is the physical floor boundary, not an ordinary
// floor component. Pure geometry shared by the Canvas render projection, the
// first-entry guidance state and Floor settings resize containment.

import type { WarehouseZone } from '../pages/FloorPlanningModuleFT2.js';

type BoundaryZone = Pick<WarehouseZone, 'type' | 'position_x' | 'position_y' | 'width' | 'depth'>;

// Floating-point tolerance for edge comparisons (dimensions snap to 0.1 m).
const EDGE_EPSILON = 1e-6;

/**
 * Canvas draws a positioned component whose persisted width/depth is null at
 * this footprint (CanvasEditor: `width ?? 1`, `depth ?? 0.8`). Containment uses
 * the same footprint so a boundary can never clip what the merchant sees.
 * Mirrored by NULL_SIZE_COMPONENT_FOOTPRINT in the backend floor-planning
 * controller. Never persisted onto the component.
 */
export const DEFAULT_COMPONENT_FOOTPRINT = { width: 1, depth: 0.8 } as const;

/** Right (width) or bottom (depth) edge of a positioned component's footprint. */
export function componentFootprintEdge(zone: BoundaryZone, axis: 'width' | 'depth'): number {
  const start = Number(axis === 'width' ? zone.position_x : zone.position_y);
  return start + (finite(zone[axis]) ?? DEFAULT_COMPONENT_FOOTPRINT[axis]);
}

function finite(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasValidDimensions(zone: BoundaryZone): boolean {
  const width = finite(zone.width);
  const depth = finite(zone.depth);
  return width != null && width > 0 && depth != null && depth > 0;
}

/**
 * A fresh root: no persisted coordinates, but a valid physical size. Canvas
 * draws it at the implicit origin (0,0) without persisting anything.
 */
export function isImplicitWarehouseRoot(zone: BoundaryZone): boolean {
  return zone.type === 'warehouse'
    && zone.position_x == null
    && zone.position_y == null
    && hasValidDimensions(zone);
}

/**
 * Render projection only: a fresh root gains the implicit (0,0) origin; every
 * other zone — including a root with persisted coordinates — is returned as-is.
 */
export function projectWarehouseRoot<T extends BoundaryZone>(zone: T): T {
  return isImplicitWarehouseRoot(zone) ? { ...zone, position_x: 0, position_y: 0 } : zone;
}

/** Persisted root origin, or the implicit (0,0) origin of a fresh root. */
export function warehouseRootOrigin(root: BoundaryZone): { x: number; y: number } {
  return { x: finite(root.position_x) ?? 0, y: finite(root.position_y) ?? 0 };
}

/** True once at least one non-root component has a position on the floor. */
export function hasPositionedOperationalZone(zones: readonly BoundaryZone[]): boolean {
  return zones.some(
    (zone) => zone.type !== 'warehouse' && zone.position_x != null && zone.position_y != null
  );
}

/**
 * Positioned non-root components that a resized root boundary would newly
 * exclude: inside the current boundary on that axis, outside the next one.
 * Growing a dimension can therefore never be rejected.
 *
 * Child edges: right = x + width, bottom = y + depth, with a null size taken
 * as DEFAULT_COMPONENT_FOOTPRINT.
 */
export function componentsExcludedByResize<T extends BoundaryZone>(
  root: BoundaryZone,
  next: { width?: number; depth?: number },
  zones: readonly T[],
): T[] {
  const origin = warehouseRootOrigin(root);
  const axes = [
    { next: next.width, current: finite(root.width), start: origin.x, edge: (z: T) => componentFootprintEdge(z, 'width') },
    { next: next.depth, current: finite(root.depth), start: origin.y, edge: (z: T) => componentFootprintEdge(z, 'depth') },
  ].filter((axis) => axis.next != null && Number.isFinite(axis.next));

  return zones.filter((zone) => {
    if (zone.type === 'warehouse' || zone.position_x == null || zone.position_y == null) return false;
    return axes.some((axis) => {
      const edge = axis.edge(zone);
      const outsideNext = edge > axis.start + (axis.next as number) + EDGE_EPSILON;
      const insideCurrent = axis.current == null || edge <= axis.start + axis.current + EDGE_EPSILON;
      return outsideNext && insideCurrent;
    });
  });
}
