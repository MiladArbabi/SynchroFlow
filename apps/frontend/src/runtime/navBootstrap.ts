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

import { registerNavGroup } from './registerNav';

export function bootstrapNavGroups() {
  console.info('[nav-bootstrap] registering platform nav groups');

  registerNavGroup({ id: 'core', label: 'Core', order: 10 });
  registerNavGroup({ id: 'operations', label: 'Operations', order: 20 });
  registerNavGroup({ id: 'analytics', label: 'Analytics', order: 30 });
  registerNavGroup({ id: 'settings', label: 'Settings', order: 40 });
}
