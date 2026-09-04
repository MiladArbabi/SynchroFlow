// apps/frontend/src/pages/ft2-pages/warehouseModuleTabs.ts
import type { ModuleTab } from '../../components/ModuleTabBar';

// COMMERCIAL-ACCESS-ARCH-01 P0-A2B: every tab migrated to capabilityId — the
// shared commercial adapter is authoritative. Warehouse Analytics previously
// declared a contradictory pair (requiredTier: 'growth' + the Starter feature
// wms.pick_batches, a no-op gate); the canonical requirement is
// warehouse.analytics -> { moduleId: 'wms', minimumTier: 'growth', feature: 'wms.analytics' }.
export const WAREHOUSE_MODULE_TABS: ModuleTab[] = [
  { id: 'wms-operations',  label: 'Operations',     path: '/wms',             capabilityId: 'warehouse.operations' },
  { id: 'floor-planning',  label: 'Floor Planning', path: '/floor-planning',  capabilityId: 'warehouse.floor_planning' },
  { id: 'wms-analytics',   label: 'Analytics',      path: '/wms/analytics',   capabilityId: 'warehouse.analytics' },
  { id: 'product-issues',  label: 'Problem Center', path: '/problem-center',  capabilityId: 'warehouse.problem_center' },
];
