/* apps/frontend/src/runtime/moduleLoader.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */

import modules from 'virtual:lasyncro-modules';
import { registerModule, unregisterModule } from './registerModule';
import { registerRoute } from './registerRoute';
import { registerNavItem, registerNavGroup } from './registerNav';

/**
 * A module descriptor shape exported by ModuleEntry.tsx
 */
export interface UIModule {
  id: string;
  name?: string;
  version?: string;
  routes?: Array<any>;
  navItems?: Array<any>;
  navGroups?: Array<any>;
  init?: (ctx: any) => void | Promise<void>;
}

/**
 * Load a module using the plugin-provided load() function.
 * The plugin guarantees each entry has:
 *   { id: string, load: () => Promise<any> }
 */
export async function loadModule(entry: { id: string; load: () => Promise<any> }): Promise<UIModule | null> {
  if (!entry || typeof entry.load !== 'function') {
    console.error('[lasyncro] loadModule: invalid entry:', entry);
    return null;
  }

  const id = entry.id;
  console.debug('[lasyncro] loadModule ->', id);

  let imported;
  try {
    imported = await entry.load();
  } catch (err) {
    console.error('[lasyncro] loadModule FAILED for', id, err);
    return null;
  }

  const desc =
    imported?.default ??
    imported?.descriptor ??
    imported;

  if (!desc?.id) {
    console.error('[lasyncro] ModuleEntry missing id:', id, desc);
    return null;
  }

  return desc as UIModule;
}

/**
 * Load and register all modules.
 */
export async function loadAllModules() {
  const loaded: Record<string, UIModule> = {};

  for (const entry of modules) {
    if (!entry?.id) {
      console.warn('[lasyncro] Skipping malformed module entry:', entry);
      continue;
    }

    const descriptor = await loadModule(entry);
    if (!descriptor) continue;

    // Register module metadata into runtime store
    registerModule({
      id: descriptor.id,
      name: descriptor.name ?? descriptor.id,
      version: descriptor.version ?? '0.0.0',
    });

    // Register routes
    if (Array.isArray(descriptor.routes)) {
      for (const r of descriptor.routes) registerRoute(r);
    }

    // Register nav items
    if (Array.isArray(descriptor.navItems)) {
      for (const n of descriptor.navItems) registerNavItem(n);
    }

    // Register nav groups
    if (Array.isArray(descriptor.navGroups)) {
      for (const g of descriptor.navGroups) registerNavGroup(g);
    }

    loaded[descriptor.id] = descriptor;
  }

  console.info('[lasyncro] Modules loaded:', Object.keys(loaded));
  return loaded;
}

/**
 * Unload module (future use)
 */
export function unloadModule(moduleId: string) {
  unregisterModule(moduleId);
}
