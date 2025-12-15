/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/routes.tsx
import React from "react";
import { DashboardPage } from "./pages/DashboardPage";
import LoginPage from "./pages/authentication/LoginPage";
import RegisterPage from "./pages/authentication/RegisterPage";
import Customer360Page from "./pages/Customer360Page";
import AccountSettingsPage from "./pages/AccountSettingsPage";
import { Product360Page } from "./pages/Product360Page";

// ✅ Route shape with entitlement metadata
export interface RouteConfig {
  type: "collapse" | "route";
  name: string;
  key: string;
  icon?: string;
  route: string;
  component: React.ComponentType<any>;

  // --- Entitlement metadata (Slice 1) ---
  requiredModuleId?: string;
  requiredFlagId?: string;
}

export interface EntitlementSnapshot {
  modules: string[]; // e.g. ['core-dashboard', 'orders-core']
  flags: string[];   // e.g. ['beta-analytics']
}

const routes: RouteConfig[] = [
  {
    type: "collapse",
    name: "Dashboard",
    key: "dashboard",
    icon: "🏠",
    route: "/dashboard",
    component: DashboardPage,
    // Core experience – no module gating
  },
  {
    type: "route",
    name: "Customer Details",
    key: "customer-details",
    route: "/customers/:id",
    component: Customer360Page,
  },
  {
    type: "route",
    name: "Product Details",
    key: "product-details",
    route: "/products/:id",
    component: Product360Page,
  },
  // 🔻 NOTE: /data-mapper and /product-intelligence have been removed from routes
  // They’re effectively deprecated for users, but code is still in the repo.

  {
    type: "route",
    name: "Account Settings",
    key: "account-settings",
    route: "/account/settings",
    component: AccountSettingsPage,
  },
  {
    type: "route",
    name: "Login",
    key: "login",
    route: "/login",
    component: LoginPage,
  },
  {
    type: "route",
    name: "Register",
    key: "register",
    route: "/register",
    component: RegisterPage,
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