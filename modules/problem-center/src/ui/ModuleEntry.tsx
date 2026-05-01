// modules/problem-center/src/ui/ModuleEntry.tsx
import { TriangleAlert } from 'lucide-react';

/**
 * SKU GAPS MODULE ENTRY
 * ----------------------
 * Registers the SKU Gaps module in the sidenav.
 *
 * Visible to: owner, admin roles (supervisor surface).
 * Route: /problem-center → ProblemCenterPage (gate page)
 *
 * Nav group: operations
 */
export default {
  id: 'problem-center',
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
      id: 'problem-center',
      title: 'SKU Gaps',
      path: '/problem-center',
      group: 'operations',
      order: 40,
      icon: TriangleAlert,
      requiredModuleId: 'wms-lite',
    },
  ],
};