// apps/frontend/src/pages/ft2-pages/returnsSubTabs.ts
//
// RETURNS SUB-TAB DEFINITION
// --------------------------
// Secondary tab bar rendered inside the Returns tab.
// Paths are sub-routes of /returns.
// Import into ReturnsFT2Page only.

import type { ModuleTab } from '../../components/ModuleTabBar';

// COMMERCIAL-ACCESS-ARCH-01 P0-A3-3: every tab declares its canonical
// capability. ModuleTabBar resolves these through the shared commercial
// adapter, so a tab and its route reach the same AccessDecision.
export const RETURNS_SUB_TABS: ModuleTab[] = [
  { id: 'returns-overview',   label: 'Overview',   path: '/returns',
    capabilityId: 'returns.core' },
  { id: 'returns-items',      label: 'Items',      path: '/returns/items',
    capabilityId: 'returns.core' },
  { id: 'returns-suppliers',  label: 'Supplier Ratings',  path: '/returns/suppliers',
    capabilityId: 'returns.analysis' },
];