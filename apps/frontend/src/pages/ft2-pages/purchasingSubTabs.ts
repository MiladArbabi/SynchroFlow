// apps/frontend/src/pages/ft2-pages/purchasingSubTabs.ts
//
// PURCHASING SUB-TAB DEFINITION
// ------------------------------
// Secondary tab bar rendered inside the Purchasing page.
// Paths are sub-routes of /suppliers-portal.
// Import into SuppliersPortalPage only.
import type { ModuleTab } from '../../components/ModuleTabBar';
// COMMERCIAL-ACCESS-ARCH-01 P0-A2B / P0-A3-5: every tab is capabilityId-driven —
// the shared commercial adapter is authoritative, never a local tier/module rule.
//
// COMMERCIAL-REMODEL-ALIGN-01 ratified split:
//   purchasing.core     (suppliers-portal, Core+)   Open POs / Suppliers
//   purchasing.sourcing (suppliers-portal, Growth+) Sourcing
// A Core merchant therefore sees Open POs and Suppliers, but not Sourcing.
export const PURCHASING_SUB_TABS: ModuleTab[] = [
  { id: 'purchasing-pos',       label: 'Open POs',  path: '/suppliers-portal',           capabilityId: 'purchasing.core' },
  { id: 'purchasing-suppliers', label: 'Suppliers', path: '/suppliers-portal/suppliers', capabilityId: 'purchasing.core' },
  {
    id: 'purchasing-sourcing', label: 'Sourcing', path: '/suppliers-portal/sourcing', capabilityId: 'purchasing.sourcing',
  },
];
