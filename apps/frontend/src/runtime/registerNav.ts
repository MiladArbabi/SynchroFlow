/* apps/frontend/src/runtime/registerNav.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon?: any;
  order?: number;
  group?: string;
  requiredModuleId?: string;
  requiredFlagId?: string;
  meta?: Record<string, any>;
}

export interface NavGroup {
  id: string;
  label: string;
  order?: number;
  items?: NavItem[];
}

const navItems: Record<string, NavItem> = {};
const navGroups: Record<string, NavGroup> = {};

let cachedNav: NavGroup[] | null = null;

// ─────────────────────────────────────────────
// Registration functions
// ─────────────────────────────────────────────

export function registerNavItem(item: NavItem) {
  if (!item?.id) throw new Error('registerNavItem(): item.id is required');

  navItems[item.id] = { ...item };
  cachedNav = null;
}

export function unregisterNavItem(id: string) {
  delete navItems[id];
  cachedNav = null;
}

export function registerNavGroup(group: NavGroup) {
  if (!group?.id) throw new Error('registerNavGroup(): group.id is required');

  navGroups[group.id] = { ...group, items: group.items ?? [] };
  cachedNav = null;
}

export function unregisterNavGroup(id: string) {
  delete navGroups[id];
  cachedNav = null;
}

// ─────────────────────────────────────────────
// Output merged + ordered UI navigation
// ─────────────────────────────────────────────

export function getNavigation(): NavGroup[] {
  if (cachedNav) return cachedNav;

  // 1. clone groups
  const groups = Object.values(navGroups).map(g => ({
    ...g,
    items: []
  }));

  const groupIndex = Object.fromEntries(groups.map(g => [g.id, g]));

  // 2. assign items into groups
  for (const item of Object.values(navItems)) {
    if (!item.group) {
      console.warn(
        '[nav-registry] nav item ignored (no group):',
        item.id
      );
      continue;
    }

    const group = groupIndex[item.group];

    if (!group) {
      console.warn(
        '[nav-registry] nav item ignored (unknown group):',
        item.id,
        '→',
        item.group
      );
      continue;
    }

    group.items!.push(item);
  }

  // 3. sort groups + items
  groups.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
  groups.forEach(g => {
    g.items!.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
  });

  cachedNav = groups;
  return groups;
}

// For debugging & tests
export function _resetNav() {
  Object.keys(navItems).forEach(k => delete navItems[k]);
  Object.keys(navGroups).forEach(k => delete navGroups[k]);
  cachedNav = null;
}
