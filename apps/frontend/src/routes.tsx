// apps/frontend/src/routes.tsx

// ✅ Route shape with entitlement metadata
export interface RouteConfig {
  key: string;
  route: string;

  requiredModuleId?: string;
  requiredFlagId?: string;
}

export interface EntitlementSnapshot {
  modules: string[]; // e.g. ['core-dashboard', 'orders-core']
  flags: string[];   // e.g. ['beta-analytics']
}

const routes: RouteConfig[] = [
  {
    key: "dashboard",
    route: "/dashboard",
  },
  {
    key: "account-settings",
    route: "/account/settings",
  },
  {
    key: "login",
    route: "/login",
  },
  {
    key: "register",
    route: "/register",
  },
];


/**
 * Runtime check: is a single route enabled for the given entitlements?
 * - If a route has no requiredModuleId / requiredFlagId → always enabled.
 * - If entitlements are missing/null → be conservative and hide gated routes.
 * - If both module + flag are specified → both must be present.
 */
export function isRouteEnabled(
  route: RouteConfig,
  entitlements: EntitlementSnapshot | null
): boolean {
  // Public routes
  if (!route.requiredModuleId && !route.requiredFlagId) {
    return true;
  }

  // If route is gated and we don't know entitlements yet, hide it
  if (!entitlements) {
    return false;
  }

  const { modules, flags } = entitlements;

  if (route.requiredModuleId && !modules.includes(route.requiredModuleId)) {
    return false;
  }

  if (route.requiredFlagId && !flags.includes(route.requiredFlagId)) {
    return false;
  }

  return true;
}

/**
 * Pure helper: filter a list of routes by entitlements.
 * Used later for Sidenav and route guards.
 */
export function filterRoutesByEntitlements(
  allRoutes: RouteConfig[],
  entitlements: EntitlementSnapshot | null
): RouteConfig[] {
  return allRoutes.filter((route) => isRouteEnabled(route, entitlements));
}

export default routes;