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
// modules/fulfillment/src/ui/ModuleEntry.tsx
// Nav registration owned by navBootstrap.ts — no navGroups/navItems here.
export default {
  id: 'fulfillment',
  name: 'Fulfillment',
  version: '0.1.0',
};