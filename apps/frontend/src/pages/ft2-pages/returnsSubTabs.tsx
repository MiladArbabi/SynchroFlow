// apps/frontend/src/pages/ft2-pages/returnsSubTabs.ts
//
// RETURNS SUB-TAB DEFINITION
// --------------------------
// Secondary tab bar rendered inside the Returns tab.
// Paths are sub-routes of /returns.
// Import into ReturnsFT2Page only.

import type { ModuleTab } from '../../components/ModuleTabBar';

export const RETURNS_SUB_TABS: ModuleTab[] = [
  { id: 'returns-overview',   label: 'Overview',   path: '/returns'       },
  { id: 'returns-items',      label: 'Items',      path: '/returns/items'     },
  { id: 'returns-suppliers',  label: 'Supplier Ratings',  path: '/returns/suppliers',
    requiredTier: 'growth' },
];