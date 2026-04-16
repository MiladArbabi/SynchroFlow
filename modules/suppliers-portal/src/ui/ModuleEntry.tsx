// modules/suppliers-portal/src/ui/ModuleEntry.tsx
import { Truck } from 'lucide-react';

/**
 * SUPPLIERS PORTAL MODULE ENTRY
 * ------------------------------
 * Registers the Suppliers Portal module in the sidenav.
 *
 * Visible to: owner, admin roles.
 * Route: /suppliers-portal → SuppliersPortalPage
 *
 * Nav group: operations
 */
export default {
  id: 'suppliers-portal',
  name: 'Suppliers Portal',
  version: '0.1.0',
  lifecycleTier: 'FT2_READY',
  navGroups: [
    {
      id: 'operations',
      label: 'Operations',
      order: 20,
    },
  ],
  navItems: [
    {
      id: 'suppliers-portal',
      title: 'Suppliers',
      path: '/suppliers-portal',
      group: 'operations',
      order: 40,
      icon: Truck,
      requiredModuleId: 'suppliers-portal',
    },
  ],
};