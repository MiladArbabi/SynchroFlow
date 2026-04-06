// modules/fulfillment/src/ui/ModuleEntry.tsx
import { PackageCheck } from 'lucide-react';

/**
 * FULFILLMENT MODULE ENTRY
 * ------------------------
 * Registers the Fulfillment Queue in the sidenav.
 *
 * Nav vocabulary: "Fulfillment Queue" — operator language.
 * Route: /fulfillment → FulfillmentQueuePage
 */
export default {
  id: 'fulfillment',
  name: 'Fulfillment',
  version: '0.1.0',
  navGroups: [
    { 
        id: 'operations', 
        label: 'Operations', order: 20 
    }
  ],
  navItems: [
    {
      id: 'fulfillment-queue',
      title: 'Fulfillment',
      path: '/fulfillment',
      group: 'operations',
      order: 20,
      icon: PackageCheck,
      requiredModuleId: 'fulfillment'
    }
  ]
};