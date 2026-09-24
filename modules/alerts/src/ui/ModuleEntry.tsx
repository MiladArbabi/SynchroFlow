// modules/alerts/src/ui/ModuleEntry.tsx
import { Bell } from 'lucide-react';

/**
 * ALERTS MODULE ENTRY
 * -------------------
 * Registers the Alerts module identity. The merchant-facing Alerts surface is
 * Recent notification history + notification Settings (GH-1147). Operational
 * alert attention remains owned by the shell / Ops Console during the #1123
 * migration.
 */
// modules/alerts/src/ui/ModuleEntry.tsx
// Nav registration owned by navBootstrap.ts — no navGroups/navItems here.
export default {
  id: 'alerts',
  name: 'Alerts',
  version: '0.1.0',
};