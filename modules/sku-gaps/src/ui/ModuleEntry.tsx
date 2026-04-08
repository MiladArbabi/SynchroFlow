// modules/sku-gaps/src/ui/ModuleEntry.tsx
import { TriangleAlert } from 'lucide-react';

/**
 * SKU GAPS MODULE ENTRY
 * ----------------------
 * Registers the SKU Gaps module in the sidenav.
 *
 * Visible to: owner, admin roles (supervisor surface).
 * Route: /sku-gaps → SkuGapsPage (gate page)
 *
 * Nav group: operations
 */
export default {
  id: 'sku-gaps',
  name: 'SKU Gaps',
  version: '0.1.0',
  navGroups: [
    {
      id: 'operations',
      label: 'Operations',
      order: 20,
    },
  ],
  navItems: [
    {
      id: 'sku-gaps',
      title: 'SKU Gaps',
      path: '/sku-gaps',
      group: 'operations',
      order: 40,
      icon: TriangleAlert,
      requiredModuleId: 'wms-lite',
    },
  ],
};