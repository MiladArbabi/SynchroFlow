// modules/floor-planning/src/ui/ModuleEntry.tsx
import { LayoutDashboard } from 'lucide-react';

/**
 * FLOOR PLANNING MODULE ENTRY
 * ----------------------------
 * Registers the Floor Planning module in the sidenav.
 *
 * Visible to: owner, admin roles.
 * Route: /floor-planning → FloorPlanningPage
 *
 * Nav group: operations
 */
export default {
  id: 'floor-planning',
  name: 'Floor Planning',
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
      id: 'floor-planning',
      title: 'Floor Planning',
      path: '/floor-planning',
      group: 'operations',
      order: 50,
      icon: LayoutDashboard,
      requiredModuleId: 'floor-planning',
    },
  ],
};