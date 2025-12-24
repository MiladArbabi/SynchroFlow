// navigation/resolveNavVisibility.ts

export type NavVisibility =
  | 'hidden'
  | 'locked'
  | 'enabled'
  | 'promoted';

interface ResolveNavVisibilityArgs {
  requiredModuleId?: string;
  modules: string[];

  /** optional host signals */
  promoteIfLocked?: boolean;
  hideIfLocked?: boolean;
}

export function resolveNavVisibility({
  requiredModuleId,
  modules,
  promoteIfLocked,
  hideIfLocked,
}: ResolveNavVisibilityArgs): NavVisibility {

  if (!requiredModuleId) return 'enabled';

  if (modules.includes(requiredModuleId)) {
    return 'enabled';
  }

  if (hideIfLocked) {
    return 'hidden';
  }

  if (promoteIfLocked) {
    return 'promoted';
  }

  return 'locked';
}