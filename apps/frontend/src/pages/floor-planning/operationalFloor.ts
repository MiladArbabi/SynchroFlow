// apps/frontend/src/pages/floor-planning/operationalFloor.ts
import type { WarehouseZone } from '@lasyncro/shared/ui';

type FloorZone = Pick<WarehouseZone, 'type' | 'position_x' | 'position_y'>;

/**
 * GH-1176 — the one "is there an operational floor?" semantic for the live-map
 * surfaces (Overview, Orders, Inventory).
 *
 * The warehouse root is the physical floor boundary, not an operational
 * location: every shop is bootstrapped with WH-{shopId}-ROOT, and a root that
 * carries geometry (even persisted at 0,0) still draws nothing to operate on.
 * A floor exists only once at least one NON-warehouse location is positioned.
 *
 * Presentation/acquisition gate only — onboarding readiness stays owned by
 * wms.zonesConfigured.
 */
export function hasOperationalFloor(zones: readonly FloorZone[]): boolean {
  return zones.some(
    (zone) => zone.type !== 'warehouse' && zone.position_x != null && zone.position_y != null
  );
}
