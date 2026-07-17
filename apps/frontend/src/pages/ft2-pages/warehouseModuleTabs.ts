// apps/frontend/src/pages/ft2-pages/warehouseModuleTabs.ts
import type { ModuleTab } from '../../components/ModuleTabBar';

export const WAREHOUSE_MODULE_TABS: ModuleTab[] = [
  { id: 'wms-operations',  label: 'Operations',     path: '/wms'              },
  { id: 'floor-planning',  label: 'Floor Planning', path: '/floor-planning',  requiredTier: 'growth'  },
  { id: 'wms-analytics',   label: 'Analytics',      path: '/wms/analytics',   requiredTier: 'growth', feature: 'wms.pick_batches' },
  { id: 'product-issues',  label: 'Problem Center', path: '/problem-center',  requiredTier: 'core'  },
];
