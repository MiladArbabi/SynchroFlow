import type { ModuleTab } from '../../components/ModuleTabBar';
// COMMERCIAL-ACCESS-ARCH-01 P0-A2B: Demand migrated to demand.forecasting —
// the shared commercial adapter is authoritative.
export const INVENTORY_MODULE_TABS: ModuleTab[] = [
  { id: 'intelligence',  label: 'Intelligence', path: '/inventory'          },
  { id: 'catalog',       label: 'Catalog',      path: '/inventory/catalog'  },
  { id: 'demand',        label: 'Demand',       path: '/demand', capabilityId: 'demand.forecasting' },
  { id: 'costs',         label: 'Costs',        path: '/inventory/costs'    },
  { id: 'data-quality',  label: 'Data Quality', path: '/inventory/data-quality' },
];