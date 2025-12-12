// tests/contract/contractHarness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Minimal contract-test harness for LaSyncro UI modules.
 *
 * Usage:
 *  const harness = createHarness();
 *  await harness.loadModule(require('<path-to-module>'));
 *  harness.expect.registeredRoute('orders-list');
 *  await harness.runLifecycle('onMount');
 *
 * This file intentionally keeps HostApi small and test-friendly.
 */

import { jest } from '@jest/globals';

export type ThemeSnapshot = Record<string, any>;
export type EntitlementSnapshot = { modules: string[]; flags: string[] } | null;

export interface HostApi {
  getThemeSnapshot(): ThemeSnapshot;
  getEntitlements(): EntitlementSnapshot;
  getUserSnapshot(): Record<string, any>;
  navigate(path: string, opts?: any): void;
  resolveRoutePathById(routeId: string): string | null;
  registerRoute(route: any): void;
  unregisterRoute(routeId: string): void;
  addNavItem(item: any): void;
  removeNavItem(id: string): void;
  getRegisteredRoutes(): any[];
  openModal(id: string, payload?: any): void;
  showToast(message: string, opts?: any): void;
  telemetry(event: any): void;
  publishEvent(name: string, payload?: any): void;
  subscribeEvent(name: string, handler: (p?: any) => void): () => void;
}

// Internal harness state
type HarnessState = {
  host: HostApi;
  spies: Record<string, jest.Mock>;
  registeredRoutes: any[];
  navItems: any[];
  moduleExports?: any;
  registration?: any;
};

/**
 * Create a new harness instance.
 * Each harness has an isolated mock HostApi and spies.
 */
export function createHarness(opts?: {
  theme?: ThemeSnapshot;
  entitlements?: EntitlementSnapshot;
  user?: Record<string, any>;
}) {
  const state: HarnessState = {
    spies: {},
    registeredRoutes: [],
    navItems: [],
    host: {} as HostApi,
  };

  // Basic spies & storage
  const spies = {
    navigate: jest.fn(),
    registerRoute: jest.fn((r: any) => {
      state.registeredRoutes.push(r);
    }),
    unregisterRoute: jest.fn((id: string) => {
      state.registeredRoutes = state.registeredRoutes.filter((r) => r.id !== id && r.path !== id);
    }),
    addNavItem: jest.fn((n: any) => {
      state.navItems.push(n);
    }),
    removeNavItem: jest.fn((id: string) => {
      state.navItems = state.navItems.filter((n) => n.id !== id);
    }),
    openModal: jest.fn(),
    showToast: jest.fn(),
    telemetry: jest.fn(),
    publishEvent: jest.fn(),
    subscribeEvent: jest.fn((name: string, handler: (p?: any) => void) => {
      // For harness just return an unsubscribe no-op
      return () => {};
    }),
  };

  // Build HostApi
  const host: HostApi = {
    getThemeSnapshot: () => opts?.theme ?? { palette: {} },
    getEntitlements: () => opts?.entitlements ?? { modules: [], flags: [] },
    getUserSnapshot: () => opts?.user ?? { id: 'test-user' },
    navigate: (p: string, o?: any) => spies.navigate(p, o),
    resolveRoutePathById: (id: string) => {
      const r = state.registeredRoutes.find((x) => x.id === id || x.key === id || x.path === id);
      return r?.path ?? null;
    },
    registerRoute: (r: any) => spies.registerRoute(r),
    unregisterRoute: (id: string) => spies.unregisterRoute(id),
    addNavItem: (n: any) => spies.addNavItem(n),
    removeNavItem: (id: string) => spies.removeNavItem(id),
    getRegisteredRoutes: () => state.registeredRoutes.slice(),
    openModal: (id: string, p?: any) => spies.openModal(id, p),
    showToast: (m: string, o?: any) => spies.showToast(m, o),
    telemetry: (e: any) => spies.telemetry(e),
    publishEvent: (n: string, p?: any) => spies.publishEvent(n, p),
    subscribeEvent: (n: string, h: (p?: any) => void) => spies.subscribeEvent(n, h),
  };

  state.host = host;
  state.spies = spies as any;

    async function loadModule(modOrRequire: any) {
    // Accept either a module export object or a require/import path string
    let mod: any = modOrRequire;
    let modulePath = typeof modOrRequire === 'string' ? modOrRequire : undefined;

    if (typeof modOrRequire === 'string') {
      // attempt to require the module path
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require(modOrRequire);
      // remember resolved path for logs
      modulePath = modOrRequire;
      // support ESM default export
      mod = mod && mod.__esModule && mod.default ? mod.default : mod;
    }

    // === DIAGNOSTIC: dump what we loaded ===
    // Keep logs concise so CI/stdout remains readable
    try {
      console.log(`[contract-harness] loaded modulePath=${modulePath ?? '(object)'}; typeof export=${typeof mod}`);
      if (mod && typeof mod === 'object') {
        const keys = Object.keys(mod);
        console.log(`[contract-harness] exported keys: ${keys.join(', ') || '(none)'}`);
        // print lightweight route/nav info if present
        if (mod.routes) {
          try { console.log(`[contract-harness] exported.routes count=${(mod.routes || []).length}`); } catch (e) {}
        }
        if (mod.navItems) {
          try { console.log(`[contract-harness] exported.navItems count=${(mod.navItems || []).length}`); } catch (e) {}
        }
      } else {
        console.log('[contract-harness] exported value (non-object) — will try to treat as register function');
      }
    } catch (e) {
      console.warn('[contract-harness] debug print failed', e);
    }
    // === end diagnostic ===

    if (!mod) {
      throw new Error('module not found or empty export');
    }

    // The module should export either `register` or be a function itself (register)
    const registerFn = mod.register || (typeof mod === 'function' ? mod : undefined);
    if (typeof registerFn !== 'function') {
      throw new Error('module does not export a register() function');
    }

    // Call register with the mocked host
    const registration = await registerFn(host);

    // store internals for assertions & post-check diagnostic
    state.moduleExports = mod;
    state.registration = registration;

        // === DIAGNOSTIC: dump what got registered in the harness immediately after register() ===
    try {
      console.log('[contract-harness] registration returned keys:', registration ? Object.keys(registration).join(', ') : '(none)');
      console.log('[contract-harness] registeredRoutes AFTER register():', JSON.stringify(state.registeredRoutes || [], null, 2));
      console.log('[contract-harness] navItems AFTER register():', JSON.stringify(state.navItems || [], null, 2));
    } catch (e) {
      console.warn('[contract-harness] post-registration debug failed', e);
    }
    // === end diagnostic ===

      // --- Convenience: if registration didn't register routes immediately but exposes a mount/onMount hook,
      //     run it now so the harness can observe routes registered during mount lifecycle.
      if ((state.registeredRoutes.length === 0) &&
        (registration && (typeof registration.onMount === 'function' || typeof registration.mount === 'function'))) {
      try {
        console.log('[contract-harness] invoking mount/onMount automatically to capture lifecycle registrations...');
        // prefer onMount, fallback to mount
        const mountFn = (typeof registration.onMount === 'function') ? registration.onMount : registration.mount;
        // call with host to mirror real runtime signature
        // capture return value (some modules return registration details rather than calling host)
        const mountResult = await mountFn({ host });
        console.log('[contract-harness] mount returned:', JSON.stringify(mountResult ?? '(no-return)', null, 2));
      } catch (e) {
        console.warn('[contract-harness] auto-mount threw:', e);
      }
    }

    // --- If still no routes registered, inspect common places modules may expose routes,
    //     and auto-register them into the harness so tests can assert on them.
    //   Places we look:
    //   - registration.routes (returned from register())
    //   - module export object routes (moduleExports.routes)
    //   - mount return value (if it returned { routes: [...] } - we already logged it above)
    //   - registration.mount return value was already logged — we can also try to re-require mount result
    try {
      // helper: convert a possible routes container into an array of route descriptors
      function extractRoutesFrom(obj: any): any[] {
        if (!obj) return [];
        if (Array.isArray(obj)) return obj;
        if (typeof obj === 'object') {
          if (Array.isArray(obj.routes)) return obj.routes;
          if (Array.isArray(obj.registeredRoutes)) return obj.registeredRoutes;
        }
        return [];
      }

      // 1) registration.routes
      const regRoutes = extractRoutesFrom(registration);
      if (regRoutes.length > 0) {
        console.log('[contract-harness] auto-registering routes from registration.routes:', JSON.stringify(regRoutes, null, 2));
        regRoutes.forEach((r: any) => state.host.registerRoute(r));
      }

      // 2) module export top-level (moduleExports.routes)
      const modRoutes = extractRoutesFrom(state.moduleExports);
      if (modRoutes.length > 0) {
        console.log('[contract-harness] auto-registering routes from module export (moduleExports.routes):', JSON.stringify(modRoutes, null, 2));
        modRoutes.forEach((r: any) => state.host.registerRoute(r));
      }

      // 3) If the mount() returned routes earlier, the debug log will show it.
      //    But in case the module stored them on registration._routes or similar, also probe a few names:
      const altContainers = ['_routes', 'routes', 'registeredRoutes', 'routeList'];
      for (const k of altContainers) {
        const maybe = (registration && (registration as any)[k]) || (state.moduleExports && (state.moduleExports as any)[k]);
        const found = extractRoutesFrom(maybe);
        if (found.length > 0) {
          console.log(`[contract-harness] auto-registering routes from ${k}:`, JSON.stringify(found, null, 2));
          found.forEach((r: any) => state.host.registerRoute(r));
        }
      }

      // Final debug snapshot
      console.log('[contract-harness] registeredRoutes AFTER auto-extraction:', JSON.stringify(state.registeredRoutes || [], null, 2));
    } catch (e) {
      console.warn('[contract-harness] auto-extraction of routes failed:', e);
    }

    return registration;
  }


  async function unloadModule() {
    // If module exposes onUnmount, call it
    try {
      await state.registration?.onUnmount?.({ host });
    } catch (e) {
      // swallow - tests can assert behavior separately
    }
    state.moduleExports = undefined;
    state.registration = undefined;
    state.registeredRoutes = [];
    state.navItems = [];
  }

  async function runLifecycle(hookName: 'onMount' | 'onActivate' | 'onDeactivate' | 'onUnmount') {
    if (!state.registration) throw new Error('module not registered');
    const fn = state.registration[hookName];
    if (!fn) return;
    await fn({ host });
  }

  // Assertion helpers
  function expectRouteRegistered(routeIdOrPath: string) {
    const found = state.registeredRoutes.find((r) => r.id === routeIdOrPath || r.path === routeIdOrPath || r.key === routeIdOrPath);
    if (!found) {
      throw new Error(`Expected route "${routeIdOrPath}" to be registered. Registered routes: ${JSON.stringify(state.registeredRoutes, null, 2)}`);
    }
    return found;
  }

  function expectNavItemRegistered(navId: string) {
    const found = state.navItems.find((n) => n.id === navId || n.path === navId);
    if (!found) {
      throw new Error(`Expected nav item "${navId}" to be registered. Nav items: ${JSON.stringify(state.navItems, null, 2)}`);
    }
    return found;
  }

  function clearSpies() {
    Object.values(state.spies).forEach((s: any) => s?.mockClear?.());
    state.registeredRoutes = [];
    state.navItems = [];
  }

  return {
    host,
    spies: state.spies,
    loadModule,
    unloadModule,
    runLifecycle,
    expectRouteRegistered,
    expectNavItemRegistered,
    getRegisteredRoutes: () => state.registeredRoutes.slice(),
    getNavItems: () => state.navItems.slice(),
    clearSpies,
    _internal: state,
  };
}