// modules/alerts/src/ui/ModuleEntry.tsx
import { Bell } from 'lucide-react';

/**
 * ALERTS MODULE ENTRY
 * -------------------
 * Registers the Alerts inbox in the sidenav.
 * Operator vocabulary: "Alerts" not "Inbox" or "Notifications".
 */
// modules/alerts/src/ui/ModuleEntry.tsx
// Nav registration owned by navBootstrap.ts — no navGroups/navItems here.
// Alerts surface is accessible via the bell icon in the topnav.
export default {
  id: 'alerts',
  name: 'Alerts',
  version: '0.1.0',
};