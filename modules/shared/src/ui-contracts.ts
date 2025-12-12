// modules/shared/src/ui-contracts.ts
// Canonical UI host/module contract types for LaSyncro.
// Keep this file as the single source-of-truth for ModuleDescriptor / HostApi types.

import React from 'react';

export type ModuleId = string; // kebab-case recommended, e.g. 'order-nexus'

export interface EntitlementSnapshot {
  modules: string[]; // e.g. ['platform','order-nexus']
  flags: string[];   // e.g. ['beta-analytics']
}

export interface UserSnapshot {
  id: string;
  email?: string;
  displayName?: string;
  roles?: string[];
}

export interface ThemeSnapshot {
  mode: 'light' | 'dark';
  palette?: Record<string, any>; // read-only snapshot - modules may read, not mutate
}

export interface RouteDescriptor {
  id: string;          // unique within module
  path: string;        // relative path, e.g. '/orders' (host may resolve with mountPath)
  exact?: boolean;
  component: React.ComponentType<any> | React.ReactNode;
  title?: string;
  requiredModuleId?: string;
  requiredFlagId?: string;
}

export interface NavItemDescriptor {
  id: string;
  label: string;
  route: string; // absolute or host will resolve mountPath + route
  icon?: React.ReactNode;
  order?: number; // lower = earlier
  requiredModuleId?: string;
  requiredFlagId?: string;
}

export interface HostApi {
  getThemeSnapshot: () => ThemeSnapshot;
  getEntitlements: () => EntitlementSnapshot | null;
  getUserSnapshot: () => UserSnapshot;
  navigate: (path: string) => void;
  registerRoute: (route: RouteDescriptor) => void;
  addNavItem: (item: NavItemDescriptor) => void;
  telemetry: (event: { name: string; payload?: any }) => void;
  openModal: (modalId: string, payload?: any) => void;
  openGlobalModal?: (modalId: string, payload?: any) => void; // alias
  publishEvent?: (topic: string, payload?: any) => void;
}

export interface ModuleLayoutProps {
  moduleId: string;
  host: {
    theme: ThemeSnapshot;
    entitlements: EntitlementSnapshot | null;
    user: UserSnapshot;
    navigate: (path: string) => void;
    openGlobalModal: (id: string, payload?: any) => void;
  };
}

export interface ModuleRegistration {
  mount: React.ComponentType<ModuleLayoutProps> | React.ReactNode;
  onMount?: (ctx: { host: HostApi }) => Promise<void> | void;
  onActivate?: (ctx: { host: HostApi }) => Promise<void> | void;
  onDeactivate?: (ctx: { host: HostApi }) => Promise<void> | void;
  onUnmount?: (ctx: { host: HostApi }) => Promise<void> | void;
}

export interface ModuleDescriptor {
  id: ModuleId; // required, unique
  version: string; // semver
  displayName: string;
  description?: string;
  icon?: React.ReactNode;
  mountPath?: string; // e.g. '/orders'
  routes?: RouteDescriptor[]; // optional; can also call registerRoute at runtime
  requiredModules?: string[]; // runtime dependencies
  requiredFlags?: string[]; // feature flags
  entitlements?: string[]; // entitlement ids
  lazy?: boolean; // hint to host
  register: (hostApi: HostApi) => ModuleRegistration;
}