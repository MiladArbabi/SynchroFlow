import type { ModuleTab } from '../../components/ModuleTabBar';
// COMMERCIAL-ACCESS-ARCH-01 P0-A2B: Demand migrated to demand.forecasting —
// the shared commercial adapter is authoritative.
export const INVENTORY_MODULE_TABS: ModuleTab[] = [
  { id: 'intelligence',  label: 'Intelligence', path: '/inventory'          },
  { id: 'items',         label: 'Items',        path: '/inventory/items'    },
  { id: 'demand',        label: 'Replenishment', path: '/inventory/replenishment', capabilityId: 'demand.forecasting' },
];
