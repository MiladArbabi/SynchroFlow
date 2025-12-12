/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/runtime/index.d.ts
export interface RouteDescriptor {
  id: string;
  key?: string;
  name?: string;
  path: string;
  component?: any;
  requiredModuleId?: string;
  requiredFlagId?: string;
  order?: number;
  meta?: Record<string, any>;
  upgradeRoute?: string;
}

export interface ModuleDescriptor {
  id: string;
  name?: string;
  version?: string;
}

export function registerRoute(route: RouteDescriptor): void;
export function unregisterRoute(routeId: string): void;
export function getRegisteredRoutes(): RouteDescriptor[];

export function registerModule(m: ModuleDescriptor): void;
export function unregisterModule(id: string): void;
export function getRegisteredModules(): ModuleDescriptor[];
