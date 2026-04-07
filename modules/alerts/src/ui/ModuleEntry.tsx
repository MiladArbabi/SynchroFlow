// modules/alerts/src/ui/ModuleEntry.tsx
import { Bell } from 'lucide-react';

/**
 * ALERTS MODULE ENTRY
 * -------------------
 * Registers the Alerts inbox in the sidenav.
 * Operator vocabulary: "Alerts" not "Inbox" or "Notifications".
 */
export default {
  id: 'alerts',
  name: 'Alerts',
  version: '0.1.0',
  navGroups: [
    { id: 'operations', label: 'Operations', order: 50 }
  ],
  navItems: [
    {
      id: 'alerts',
      title: 'Alerts',
      path: '/alerts',
      group: 'operations',
      order: 50,
      icon: Bell,
      requiredModuleId: 'alerts'
    }
  ]
};