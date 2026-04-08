// modules/wms/src/ui/ModuleEntry.tsx
import { ScanBarcode } from 'lucide-react';

/**
 * WMS MODULE ENTRY
 * ----------------
 * Registers the WMS-Lite module in the sidenav.
 *
 * Visible to: operator, owner, admin roles.
 * Route: /wms → WmsPage (gate page)
 *
 * Nav group: operations
 */
export default {
  id: 'wms',
  name: 'Warehouse',
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
      id: 'wms',
      title: 'Warehouse',
      path: '/wms',
      group: 'operations',
      order: 30,
      icon: ScanBarcode,
      requiredModuleId: 'wms-lite',
    },
  ],
};