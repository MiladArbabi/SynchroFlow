// apps/frontend/src/menu-items/index.ts
/**
 * ⚠️ LEGACY SIDENAV CONFIG (READ-ONLY)
 *
 * Do NOT add new items here.
 * All new navigation must be provided by UI modules via ModuleEntry.tsx.
 *
 * This file exists only to support legacy pages during migration.
 */


import { MenuItems } from './types';

// CORRECTED STRUCTURE: Must conform to MenuItems interface
const menuItems: MenuItems = {
  items: [
    {
      id: 'entities-group',
      title: 'Entities', // Optional group title
      type: 'group',
      children: [] // orders, customers → REMOVED
    },
      {
     id: 'intelligence-group',
     title: 'Intelligence',
     type: 'group',
     children: [] // REMOVED
   },
    {
      id: 'communication-group',
      type: 'group',
      children: []
    }
    // Old, removed items (dataMapper, productIntelligence) are gone.
  ]
};

export default menuItems;