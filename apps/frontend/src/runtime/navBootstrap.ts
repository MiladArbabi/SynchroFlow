/* apps/frontend/src/runtime/navBootstrap.ts
 *
 * Platform-owned navigation bootstrap.
 *
 * This file defines the persistent sidebar structure.
 * Modules are NOT allowed to create top-level nav groups.
 *
 * Invariants:
 * - Groups always exist, even before modules load
 * - Order is platform-controlled
 * - Modules may only register nav ITEMS into these groups
 */

import { registerNavGroup, registerNavItem } from './registerNav';
import { Users } from 'lucide-react';

export function bootstrapNavGroups() {
  registerNavGroup({ id: 'core', label: 'Core', order: 10 });
  registerNavGroup({ id: 'operations', label: 'Operations', order: 20 });
  registerNavGroup({ id: 'analytics', label: 'Analytics', order: 30 });
  registerNavGroup({ id: 'settings', label: 'Settings', order: 40 });

  /**
   * PLATFORM NAV ITEMS (WM-31)
   * --------------------------
   * Core platform pages registered here — not via modules.
   * No requiredModuleId → always visible in FT2 to owner/admin.
   * Role filtering for operator is handled in MembersPage (backend enforces).
   */
  registerNavItem({
    id: 'team',
    title: 'Team',
    path: '/team',
    group: 'settings',
    order: 10,
    icon: Users,
  });
}
