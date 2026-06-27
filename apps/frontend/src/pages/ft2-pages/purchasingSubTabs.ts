// apps/frontend/src/pages/ft2-pages/purchasingSubTabs.ts
//
// PURCHASING SUB-TAB DEFINITION
// ------------------------------
// Secondary tab bar rendered inside the Purchasing page.
// Paths are sub-routes of /suppliers-portal.
// Import into SuppliersPortalPage only.
import type { ModuleTab } from '../../components/ModuleTabBar';
export const PURCHASING_SUB_TABS: ModuleTab[] = [
  { id: 'purchasing-pos',       label: 'Open POs',  path: '/suppliers-portal'           },
  { id: 'purchasing-suppliers', label: 'Suppliers', path: '/suppliers-portal/suppliers' },
];