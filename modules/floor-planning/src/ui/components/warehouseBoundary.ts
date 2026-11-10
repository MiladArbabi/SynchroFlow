// modules/floor-planning/src/ui/components/warehouseBoundary.ts
//
// GH-1176 — the warehouse root is the physical floor boundary, not an ordinary
// floor component. Pure geometry shared by the Canvas render projection, the
// first-entry guidance state and Floor settings resize containment.

import { DEFAULT_COMPONENT_FOOTPRINT } from '@lasyncro/shared/ui';
export { DEFAULT_COMPONENT_FOOTPRINT, isImplicitWarehouseRoot, projectWarehouseRoot } from '@lasyncro/shared/ui';

import type { WarehouseZone } from '../pages/FloorPlanningModuleFT2.js';

type BoundaryZone = Pick<WarehouseZone, 'type' | 'position_x' | 'position_y' | 'width' | 'depth'>;

// Floating-point tolerance for edge comparisons (dimensions snap to 0.1 m).
const EDGE_EPSILON = 1e-6;

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
