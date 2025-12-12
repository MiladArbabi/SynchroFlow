// Minimal route registration stub used by modules
export interface RouteDescriptor {
  id: string;
  key?: string;
  name?: string;
  path: string;
  component?: any;
  requiredModuleId?: string;
  order?: number;
  meta?: Record<string, any>;
}

export function registerRoute(route: RouteDescriptor): void;
export function unregisterRoute(routeId: string): void;
export function getRegisteredRoutes(): RouteDescriptor[];