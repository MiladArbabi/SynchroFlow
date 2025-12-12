// modules/shared/src/ui-contracts.ts
import React from 'react';

/**
 * Shared UI contract types — authoritative.
 * Keep this file small and stable. Import these types from modules and host code.
 */

/* ---- Basic snapshots ---- */
export type ThemeSnapshot = {
  mode: 'light' | 'dark';
  palette?: Record<string, any>;
  spacing?: (n: number) => number | string;
};

export type EntitlementSnapshot = {
  modules: string[]; // e.g. ['order-nexus']
  flags: string[];   // e.g. ['beta-analytics']
};

export type UserSnapshot = {
  id: string;
  email?: string;
  displayName?: string;
  roles?: string[];
};

/* ---- HostApi ---- */
export interface ToastOptions {
  duration?: number;
  type?: 'info' | 'success' | 'warning' | 'error';
}

export interface TelemetryEvent {
  name: string;
  payload?: Record<string, any>;
  ts?: number;
}

export interface RuntimeRouteDescriptor {
  id: string;
  name?: string;
  path: string; // absolute or relative to module mountPath (host normalizes)
  component: React.ComponentType<any> | React.LazyExoticComponent<any>;
  requiredModuleId?: string;
  requiredFlagId?: string;
  upgradeRoute?: string | null;
  meta?: Record<string, any>;
  order?: number;
}

export interface NavItemDescriptor {
  id: string;
  label: string;
  path?: string;
  icon?: React.ReactNode;
  requiredModuleId?: string;
  order?: number;
}

export interface HostApi {
  // read-only snapshots
  getThemeSnapshot(): ThemeSnapshot;
  getEntitlements(): EntitlementSnapshot | null;
  getUserSnapshot(): UserSnapshot;

  // navigation
  navigate(path: string, opts?: { replace?: boolean; state?: any }): void;
  resolveRoutePathById?(routeId: string): string | null; // optional helper

  // runtime registry
  registerRoute(route: RuntimeRouteDescriptor): void;
  unregisterRoute(routeId: string): void;
  addNavItem(item: NavItemDescriptor): void;
  removeNavItem(navId: string): void;
  getRegisteredRoutes(): RuntimeRouteDescriptor[];

  // UI helpers
  openModal(modalId: string, payload?: any): void;
  openDrawer(drawerId: string, payload?: any): void;
  showToast(message: string, opts?: ToastOptions): void;

  // telemetry & logging
  telemetry(ev: TelemetryEvent): void;

  // event bus (subscribe returns unsubscribe)
  publishEvent(name: string, payload?: any): void;
  subscribeEvent(name: string, handler: (payload?: any) => void): () => void;
}

/* ---- Module registration ---- */
export interface ModuleDescriptor {
  id: string; // kebab-case
  version: string; // semver
  displayName: string;
  mountPath?: string; // recommended leading slash
  entitlements?: string[];
  lazy?: boolean;
  // Note: the host loader will look for `descriptor` or `src/descriptor.json`
}

/* mount props passed into ModuleLayout components */
export interface ModuleLayoutProps {
  moduleId: string;
  host: {
    theme: ThemeSnapshot;
    entitlements: EntitlementSnapshot | null;
    user: UserSnapshot;
    navigate: (path: string) => void;
    openGlobalModal?: (id: string, payload?: any) => void;
  };
}

export interface MountContext {
  host: HostApi;
  moduleId: string;
}

export interface ActivateContext {
  host: HostApi;
  moduleId: string;
  route?: string;
}

export interface ModuleRegistration {
  mount: React.ComponentType<ModuleLayoutProps> | React.ReactNode;
  onMount?: (ctx: MountContext) => Promise<void> | void;
  onActivate?: (ctx: ActivateContext) => Promise<void> | void;
  onDeactivate?: (ctx: ActivateContext) => Promise<void> | void;
  onUnmount?: (ctx: MountContext) => Promise<void> | void;
}

/* ---- Gated placeholder ---- */
export interface GatedPlaceholderProps {
  routeName: string;
  missingModules?: string[];
  missingFlags?: string[];
  upgradeRoute?: string | null;
  backRoute?: string;
}
