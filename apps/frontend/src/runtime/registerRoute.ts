/* apps/frontend/src/runtime/registerRoute.ts */
/* eslint-disable @typescript-eslint/no-explicit-any */
import routesStatic from 'routes'; // mapped by tsconfig paths and jest moduleNameMapper
// Re-declare a minimal RouteDescriptor here so we don't depend on docs/types
export interface RouteDescriptor {
  id: string;
  name?: string;
  key?: string;
  type?: 'route' | 'collapse' | string;
  icon?: any;
  path: string;
  component?: any;
  requiredModuleId?: string;
  requiredFlagId?: string;
  order?: number;
  meta?: Record<string, any>;
}

type InternalRoute = RouteDescriptor & { _registeredAt?: number };

const dynamicRoutes: Record<string, InternalRoute> = {};
let mergedRoutesCache: InternalRoute[] | null = null;

let notifyRoutesChanged: (() => void) | null = null;

export function _setRoutesChangeNotifier(fn: () => void) {
  notifyRoutesChanged = fn;
}

export function registerRoute(route: InternalRoute) {
  console.groupCollapsed(
    '[registerRoute]',
    route.id,
    'path=', route.path
  );
  console.trace('called from');
  console.groupEnd();

  if (!route || !route.id) {
    throw new Error('registerRoute: route.id required');
  }

  dynamicRoutes[route.id] = { ...route, _registeredAt: Date.now() };
  mergedRoutesCache = null;
  notifyRoutesChanged?.();
}

export function unregisterRoute(routeId: string) {
  delete dynamicRoutes[routeId];
  mergedRoutesCache = null;

  notifyRoutesChanged?.();
}

export function getRegisteredRoutes(): InternalRoute[] {
  if (mergedRoutesCache) return mergedRoutesCache;

  // Normalize the static routes list (routesStatic comes from apps/frontend/src/routes.tsx)
  const staticNormalized: InternalRoute[] = (routesStatic as any[]).map((r) => ({
    id: r.key || r.route || `${r.name}`,
    type: r.type || 'route',
    name: r.name,
    key: r.key,
    icon: r.icon,
    path: r.route || r.path,
    component: r.component,
    requiredModuleId: r.requiredModuleId,
    requiredFlagId: r.requiredFlagId,
    order: (r as any).order ?? 1000,
    meta: (r as any).meta ?? {}
  }));

  const dynamicList = Object.values(dynamicRoutes);
  mergedRoutesCache = [...staticNormalized, ...dynamicList].sort((a, b) => (a.order || 1000) - (b.order || 1000));
  return mergedRoutesCache;
}

// Convenience navigation helper (fallback only)
export function navigate(path: string, opts?: { replace?: boolean; state?: any }) {
  if (opts?.replace) {
    window.history.replaceState(opts.state ?? null, '', path);
  } else {
    window.history.pushState(opts?.state ?? null, '', path);
  }
}

// Helper: resolve route by id/key -> path
export function resolveRoutePathById(routeId: string): string | null {
  const route = getRegisteredRoutes().find((r) => r.id === routeId || r.key === routeId);
  return route ? route.path : null;
}