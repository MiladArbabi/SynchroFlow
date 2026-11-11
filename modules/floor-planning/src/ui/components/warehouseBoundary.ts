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
 * exclude or worsen on an edge, including existing legacy violations.
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
  const width = next.width ?? finite(root.width);
  const depth = next.depth ?? finite(root.depth);
  if (width == null || depth == null || !Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0) return [];
  const currentBoundary = (finite(root.width) ?? 0) > 0 && (finite(root.depth) ?? 0) > 0;
  return zones.filter(zone => {
    if (zone.type === 'warehouse' || zone.position_x == null || zone.position_y == null) return false;
    // A first usable boundary establishes near edges as well as far edges.
    if (!currentBoundary && (origin.x - Number(zone.position_x) > EDGE_EPSILON
      || origin.y - Number(zone.position_y) > EDGE_EPSILON)) return true;
    return (['width', 'depth'] as const).some(axis => {
      const start = axis === 'width' ? origin.x : origin.y;
      const edge = componentFootprintEdge(zone, axis);
      const before = currentBoundary ? Math.max(0, edge - start - Number(root[axis])) : 0;
      const after = Math.max(0, edge - start - (axis === 'width' ? width : depth));
      return after > before + EDGE_EPSILON;
    });
  });
}

export type GeometryInputField = 'position_x' | 'position_y' | 'width' | 'depth' | 'rack_levels';

/** Blank means no edit; null is sent only by an explicit Clear action. */
export function parseGeometryInput(raw: string, field: GeometryInputField): { value?: number; error?: string } {
  const text = raw.trim();
  if (!text) return {};
  const levels = field === 'rack_levels';
  const max = levels ? 20 : field === 'width' || field === 'depth' ? 999.999 : 99999.999;
  const min = levels ? 1 : field === 'width' || field === 'depth' ? 0.001 : 0;
  const syntax = levels ? /^\d+$/ : /^(?:\d+(?:\.\d{0,3})?|\.\d{1,3})$/;
  const value = Number(text);
  if (!syntax.test(text) || !Number.isFinite(value) || value < min || value > max) {
    return { error: levels ? 'Enter a whole number from 1 to 20.' : `Enter ${min}–${max} m with at most three decimal places.` };
  }
  return { value };
}

/** Preserve actionable validation details without exposing arbitrary server failures. */
export function geometryErrorMessage(failure: unknown, fallback = 'Could not save geometry. Please try again.'): string {
  const response = (failure as { response?: { status?: number; data?: { message?: unknown; error?: unknown; location_codes?: unknown } } })?.response;
  if (response?.status !== 400 && response?.status !== 422) return fallback;
  const data = response.data;
  const message = typeof data?.message === 'string' ? data.message : typeof data?.error === 'string' ? data.error : fallback;
  const codes = Array.isArray(data?.location_codes) ? data.location_codes.filter((code): code is string => typeof code === 'string') : [];
  return codes.length ? `${message} Affected locations: ${codes.join(', ')}.` : message;
}
