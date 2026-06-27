import type { ModuleTab } from '../../components/ModuleTabBar';
export const INVENTORY_MODULE_TABS: ModuleTab[] = [
  { id: 'intelligence',  label: 'Intelligence', path: '/inventory'          },
  { id: 'catalog',       label: 'Catalog',      path: '/inventory/catalog'  },
  { id: 'demand',        label: 'Demand',       path: '/demand', requiredTier: 'growth' },
  { id: 'costs',         label: 'Costs',        path: '/inventory/costs'    },
  { id: 'data-quality',  label: 'Data Quality', path: '/wms/readiness'      },
];