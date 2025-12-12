/* apps/frontend/src/runtime/registerModule.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Minimal module registry & nav-item API
 * - registerModule(moduleDescriptor)
 * - unregisterModule(moduleId)
 * - getRegisteredModules()
 * - registerNavItem(navItem)
 * - unregisterNavItem(navItemId)
 * - getNavItems()
 *
 * Keep lightweight and testable for Step 6.
 */

export interface ModuleDescriptor {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  // optional startup hook the host can call
  register?: (hostApi?: any) => any;
  unregister?: () => any;
  meta?: Record<string, any>;
}

export interface NavItemDescriptor {
  id: string;
  title: string;
  path?: string;
  icon?: React.ReactNode;
  order?: number;
  // optional entitlement gating
  requiredModuleId?: string;
  requiredFlagId?: string;
  meta?: Record<string, any>;
}

const modulesStore: Record<string, ModuleDescriptor> = {};
const navItemStore: Record<string, NavItemDescriptor> = {};
let modulesCache: ModuleDescriptor[] | null = null;
let navCache: NavItemDescriptor[] | null = null;

export function registerModule(mod: ModuleDescriptor) {
  if (!mod || !mod.id) throw new Error('registerModule: id required');
  modulesStore[mod.id] = mod;
  modulesCache = null;
}

export function unregisterModule(moduleId: string) {
  delete modulesStore[moduleId];
  modulesCache = null;
}

export function getRegisteredModules(): ModuleDescriptor[] {
  if (modulesCache) return modulesCache;
  modulesCache = Object.values(modulesStore).sort((a, b) => (a.id > b.id ? 1 : -1));
  return modulesCache;
}

/* Nav items API */

export function registerNavItem(item: NavItemDescriptor) {
  if (!item || !item.id) throw new Error('registerNavItem: id required');
  navItemStore[item.id] = { ...item, order: item.order ?? 1000 };
  navCache = null;
}

export function unregisterNavItem(itemId: string) {
  delete navItemStore[itemId];
  navCache = null;
}

export function getNavItems(): NavItemDescriptor[] {
  if (navCache) return navCache;
  navCache = Object.values(navItemStore).sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000));
  return navCache;
}

/* Convenience: clear all (test only) */
export function __clearAllForTests() {
  for (const k of Object.keys(modulesStore)) delete modulesStore[k];
  for (const k of Object.keys(navItemStore)) delete navItemStore[k];
  modulesCache = null;
  navCache = null;
}