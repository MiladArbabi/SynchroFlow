/* eslint-disable @typescript-eslint/no-unused-vars */
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

// FT-1 activation resolver (host-owned)
function resolveModuleActivation(moduleId: string) {
  /**
   * FT-1 RULE:
   * - No integration → inactive
   * - Integration exists → active
   *
   * IMPORTANT:
   * This resolver is intentionally dumb for now.
   * We will extend it later with sync-status, FT0, FT1, etc.
   */

  // TEMP: global integration snapshot (already exists in host)
  const integration = (window as any).__LASYNCRO_INTEGRATION_STATE__;

  const active = Boolean(integration?.hasIntegrations);

  return {
    active,
    config: {
      moduleId,
      identity: {
        title: 'Connect your store'
      },
      blindness: {
        content: (
          <p>
            Your store is not connected yet. Orders, customers and insights
            are currently invisible.
          </p>
        )
      },
      absenceProof: {
        content: (
          <p>
            Without a connection, we cannot sync or canonicalize your data.
          </p>
        )
      },
      valueAfterActivation: {
        content: (
          <p>
            Once connected, your orders will sync automatically and unlock
            analytics.
          </p>
        )
      },
      primaryCTA: {
        label: 'Connect Shopify',
        actionId: 'connect-store' as const
      },
      trust: {
        bullets: [
          'Read-only access',
          'Disconnect anytime',
          'No impact on your store'
        ]
      }
    }
  };
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

  if (import.meta.env.DEV) {
    console.debug('[lasyncro] Module load result', {
      moduleId: id,
      imported,
      resolvedDescriptor: desc
    });
  };

  if (!desc || typeof desc !== 'object') {
    throw new Error(
      `[lasyncro][FATAL] Module '${id}' did not export a valid descriptor object`
    );
  }

  if (!desc.id) {
    throw new Error(
      `[lasyncro][FATAL] ModuleEntry.id missing for module '${id}'. 
      This indicates an invalid export or premature load.`
    );
  }

  if (desc.id !== id) {
    console.warn(
      '[lasyncro][WARN] ModuleEntry.id mismatch',
      { expected: id, actual: desc.id }
    );
  }

  return desc as UIModule;
}

/**
 * Load and register all modules.
 */
let modulesLoaded = false;

export async function loadAllModules() {
  if (modulesLoaded) {
    if (import.meta.env.DEV) {
      console.debug('[lasyncro] loadAllModules skipped (already loaded)');
    }
    return {}; // ✅ ALWAYS return an object
  }

  modulesLoaded = true;

  const loaded: Record<string, UIModule> = {};

  for (const entry of modules) {
    if (!entry?.id) {
      console.warn('[lasyncro] Skipping malformed module entry:', entry);
      continue;
    }

    const descriptor = await loadModule(entry);
    if (import.meta.env.DEV) {
      console.debug('[lasyncro][module-registered]', {
        moduleId: descriptor.id,
        routes: descriptor.routes?.length ?? 0,
        navItems: descriptor.navItems?.length ?? 0,
        navGroups: descriptor.navGroups?.length ?? 0
      });
    }

    if (!descriptor) continue;

    // Register module metadata into runtime store
    registerModule({
      id: descriptor.id,
      name: descriptor.name ?? descriptor.id,
      version: descriptor.version ?? '0.0.0',
    });

    // 1️⃣ Lifecycle-based registration (preferred)
    if (typeof (descriptor as any).register === 'function') {
      await (descriptor as any).register({
        registerRoute,
        registerNavItem,
        registerNavGroup
      });
    }

    // 2️⃣ Static fallback registration WITH activation boundary
    if (Array.isArray(descriptor.routes)) {
      for (const r of descriptor.routes) {
        registerRoute(r);
      }
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
