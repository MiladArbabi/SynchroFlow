// Minimal ambient declarations used by UI modules during isolated ts compile
export interface ModuleDescriptor {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  meta?: Record<string, any>;
}

export function registerModule(mod: ModuleDescriptor): void;
export function unregisterModule(moduleId: string): void;
export function getRegisteredModules(): ModuleDescriptor[];