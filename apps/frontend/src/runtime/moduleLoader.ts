/* apps/frontend/src/runtime/moduleLoader.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */

import modules from 'virtual:lasyncro-modules';
import { registerModule, unregisterModule } from './registerModule';
import { registerRoute } from './registerRoute';
import { registerNavItem, registerNavGroup } from './registerNav';

// Our contract for what each module must export as default.
// This matches 09-UI-Module-Lifecycle-Contract.md
export interface UIModule {
  id: string;
  name?: string;
  version?: string;

  // optional
  init?: (ctx: any) => void | Promise<void>;
  beforeMount?: () => void | Promise<void>;
  afterMount?: () => void | Promise<void>;
  beforeUnmount?: () => void | Promise<void>;

  // The module’s UI surface
  routes?: Array<any>;
  navItems?: Array<any>;
  navGroups?: Array<any>;
}

/**
 * LOAD a single module by ID.
 * (the plugin gives us an array of { id, load } objects)
 */
export async function loadModule(moduleId: string) {
  const mod = modules.find(m => m.id === moduleId);
  if (!mod) throw new Error(`Module '${moduleId}' not found`);

  const exported = (await mod.load()) as UIModule;

  if (!exported?.id) {
    throw new Error(
      `Module '${moduleId}' does not export a valid ModuleEntry (missing id)`
    );
  }

  // ─────────────────────────────────────────
  // 1. Register module metadata
  // ─────────────────────────────────────────
  registerModule({
    id: exported.id,
    name: exported.name,
    version: exported.version ?? '0.0.0',
  });

  // ─────────────────────────────────────────
  // 2. Register UI primitives (routes + nav)
  // ─────────────────────────────────────────
  if (Array.isArray(exported.routes)) {
    for (const r of exported.routes) registerRoute(r);
  }

  if (Array.isArray(exported.navGroups)) {
    for (const g of exported.navGroups) registerNavGroup(g);
  }

  if (Array.isArray(exported.navItems)) {
     for (const item of exported.navItems) registerNavItem(item);
  }

  // ─────────────────────────────────────────
  // 3. Run lifecycle: init()
  // ─────────────────────────────────────────
  if (exported.init) {
    await exported.init({
      // host services available to modules
      navigate: (path: string) =>
        (window as any)._lasyncroNavigate?.(path),
      entitlements: (window as any)._lasyncroEntitlements,
      config: (window as any)._lasyncroConfig,
    });
  }

  return exported;
}

/**
 * LOAD ALL MODULES discovered by the Vite plugin.
 */
export async function loadAllModules() {
  const loaded: Record<string, UIModule> = {};

  for (const m of modules) {
    const moduleEntry = await loadModule(m.id);
    loaded[m.id] = moduleEntry;
  }

  return loaded;
}

/**
 * UNLOAD a module (rarely needed; mainly for HMR)
 */
export function unloadModule(moduleId: string) {
  unregisterModule(moduleId);
  // TODO: add unregisterRoute + unregisterNavItem when needed
}
