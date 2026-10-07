// apps/frontend/src/pages/ft2-pages/warehouseModuleTabs.ts
import type { ModuleTab } from '../../components/ModuleTabBar';

// COMMERCIAL-ACCESS-ARCH-01 P0-A2B: every tab migrated to capabilityId — the
// shared commercial adapter is authoritative. Warehouse Analytics previously
// declared a contradictory pair (requiredTier: 'growth' + the Starter feature
// wms.pick_batches, a no-op gate); the canonical requirement is
// warehouse.analytics -> { moduleId: 'wms', minimumTier: 'growth', feature: 'wms.analytics' }.
//
// GH-1222: allowedRoles is advisory role visibility, applied before the
// commercial decision. Floor Planning and Analytics are owner/admin management
// surfaces. Problem Center BASE access is operational (warehouse.operations);
// warehouse.problem_center gates Growth-only functions inside the surface, not
// entry to it.
const ALL_ROLES = ['owner', 'admin', 'operator'] as const;
const MANAGEMENT_ROLES = ['owner', 'admin'] as const;

export const WAREHOUSE_MODULE_TABS: ModuleTab[] = [
  { id: 'wms-operations',  label: 'Operations',     path: '/wms',             capabilityId: 'warehouse.operations',     allowedRoles: ALL_ROLES },
  { id: 'floor-planning',  label: 'Floor Planning', path: '/floor-planning',  capabilityId: 'warehouse.floor_planning', allowedRoles: MANAGEMENT_ROLES },
  { id: 'wms-analytics',   label: 'Analytics',      path: '/wms/analytics',   capabilityId: 'warehouse.analytics',      allowedRoles: MANAGEMENT_ROLES },
  { id: 'product-issues',  label: 'Problem Center', path: '/problem-center',  capabilityId: 'warehouse.operations',     allowedRoles: ALL_ROLES },
];
