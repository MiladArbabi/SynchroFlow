/* modules/analytics/src/ui/ModuleDescriptor.ts
 * Minimal TypeScript descriptor helper used by the module
 */

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
}

export interface NavItemDescriptor {
  id: string;
  title: string;
  path: string;
  order?: number;
  group?: string;
  requiredModuleId?: string;
}

export interface ModuleDescriptor {
  id: string;
  name?: string;
  version?: string;
  routes?: RouteDescriptor[];
  navItems?: NavItemDescriptor[];
  meta?: Record<string, any>;
}
