/* apps/frontend/src/runtime/registerNav.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface NavItem {
  id: string;
  title: string;              // ← aligns with ModuleEntry descriptors
  path: string;
  icon?: any;

  order?: number;
  group?: string;

  requiredModuleId?: string;
  requiredFlagId?: string;
  /** Minimum subscription tier required to show this nav item (MON-06) */
  requiredTier?: string;
  /** Submodule children — compact mode: hover popover right. Expanded mode: inline accordion. */
  children?: { id: string; title: string; path: string; requiredTier?: string; parentId?: string }[];
  meta?: Record<string, unknown>;
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

export function getBreadcrumbLabel(pathname: string): { label: string; parentLabel?: string } | null {
  // ISS-107: check children first — a child sharing its parent's path
  // (e.g. Returns' "order-issues" child at /returns, same as its parent
  // "returns-resolution") must win the match, since it's the more specific,
  // user-facing label. Falling through to the parent-only match below
  // handles items with no path-colliding child (Warehouse, Inventory, etc).
  for (const item of Object.values(navItems)) {
    const child = item.children?.find(c => c.path === pathname);
    if (child) {
      const parentTitle = child.parentId
        ? navItems[child.parentId]?.title ?? item.title
        : item.title;
      return { label: child.title, parentLabel: parentTitle };
    }
  }
  for (const item of Object.values(navItems)) {
    if (item.path === pathname) return { label: item.title };
  }
  return null;
}

// For debugging & tests
export function _resetNav() {
  Object.keys(navItems).forEach(k => delete navItems[k]);
  Object.keys(navGroups).forEach(k => delete navGroups[k]);
  cachedNav = null;
}
